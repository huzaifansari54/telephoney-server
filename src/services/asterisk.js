// src/services/asterisk.js
// Low-level connection to Asterisk via AMI (Asterisk Manager Interface).
//
// Responsibilities:
//   - Maintain a persistent, auto-reconnecting AMI connection
//   - Originate (start) outbound calls via the AMI Originate action
//   - Emit call lifecycle events (start, ring, answer, end) to the app
//   - Query CDR (Call Detail Records) for call history
//
// References:
//   https://www.voip-info.org/asterisk-manager-api-action-originate/
//   https://www.voip-info.org/asterisk-ami/

const AmiClient = require('asterisk-ami-client');
const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// ─── Event emitter shared across the app ─────────────────────────────────────
// Other modules (e.g. webhooks.js) subscribe to these events:
//   'call:start'    — new channel created
//   'call:ringing'  — remote party is ringing
//   'call:answered' — call was answered / bridged
//   'call:end'      — call hung up
//   'call:failed'   — call could not be completed
const asteriskEvents = new EventEmitter();

// ─── Internal state ───────────────────────────────────────────────────────────
let amiClient = null;
let connected = false;
let reconnectTimer = null;
const RECONNECT_DELAY_MS = 5000;

// Map ActionID → call tracking data (for correlating Originate responses)
const pendingCalls = new Map();

/**
 * connect()
 * Establishes a persistent AMI connection. Call this once at startup.
 * The client auto-reconnects on disconnection.
 */
async function connect() {
    if (connected) return;

    amiClient = new AmiClient({
        reconnect: true,
        maxAttemptsCount: 0,         // unlimited reconnect attempts
        attemptsDelay: RECONNECT_DELAY_MS,
        keepAlive: true,
        keepAliveDelay: 5000,
        emitEventsByTypes: true,     // emit typed events (e.g. 'Newchannel')
        emitResponsesById: true,
    });

    const host = process.env.AMI_HOST || '127.0.0.1';
    const port = parseInt(process.env.AMI_PORT || '5038', 10);
    const username = process.env.AMI_USERNAME || 'crm_user';
    const secret = process.env.AMI_SECRET;

    if (!secret) {
        logger.error('AMI_SECRET is not set in environment — cannot connect to Asterisk');
        throw new Error('AMI_SECRET environment variable is required');
    }

    try {
        await amiClient.connect(username, secret, { host, port });
        connected = true;
        logger.info(`Connected to Asterisk AMI at ${host}:${port}`);
        _registerAmiEventHandlers();
    } catch (err) {
        logger.warn(`Could not connect to Asterisk AMI at ${host}:${port} — will retry in ${RECONNECT_DELAY_MS / 1000}s`, {
            error: err.message,
        });
        logger.warn('ℹ️  This is normal if FreePBX is not running locally. All other API endpoints still work.');
        _scheduleReconnect();
        // Do NOT throw — let the server start fine without Asterisk
        return;
    }

    // Handle unexpected disconnections
    amiClient.on('disconnect', () => {
        connected = false;
        logger.warn('Asterisk AMI disconnected — will attempt to reconnect');
        _scheduleReconnect();
    });

    amiClient.on('internalError', (err) => {
        logger.error('Asterisk AMI internal error', { error: err.message });
    });
}

/**
 * _scheduleReconnect()
 * Schedules a reconnection attempt after RECONNECT_DELAY_MS.
 */
function _scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        logger.info('Attempting to reconnect to Asterisk AMI…');
        try {
            await connect();
        } catch (err) {
            logger.error('Reconnect attempt failed', { error: err.message });
        }
    }, RECONNECT_DELAY_MS);
}

/**
 * _registerAmiEventHandlers()
 * Listen to raw AMI events and translate them into our internal events.
 */
function _registerAmiEventHandlers() {
    if (!amiClient) return;

    // ── Call initiated (new channel) ─────────────────────────
    amiClient.on('Newchannel', (event) => {
        logger.debug('AMI event: Newchannel', { uniqueid: event.Uniqueid });
        asteriskEvents.emit('call:start', {
            uniqueid: event.Uniqueid,
            channel: event.Channel,
            callerIdNum: event.CallerIDNum,
            callerIdName: event.CallerIDName,
            exten: event.Exten,
            timestamp: new Date().toISOString(),
        });
    });

    // ── Phone is ringing ─────────────────────────────────────
    amiClient.on('DialBegin', (event) => {
        logger.debug('AMI event: DialBegin', { uniqueid: event.Uniqueid });
        asteriskEvents.emit('call:ringing', {
            uniqueid: event.Uniqueid,
            destUniqueid: event.DestUniqueid,
            dialString: event.DialString,
            timestamp: new Date().toISOString(),
        });
    });

    // ── Call answered / bridged ───────────────────────────────
    amiClient.on('BridgeEnter', (event) => {
        logger.debug('AMI event: BridgeEnter', { uniqueid: event.Uniqueid });
        asteriskEvents.emit('call:answered', {
            uniqueid: event.Uniqueid,
            bridgeId: event.BridgeUniqueid,
            timestamp: new Date().toISOString(),
        });
    });

    // ── Call ended ────────────────────────────────────────────
    amiClient.on('Hangup', (event) => {
        logger.debug('AMI event: Hangup', {
            uniqueid: event.Uniqueid,
            cause: event.Cause,
            causeTxt: event['Cause-txt'],
        });
        asteriskEvents.emit('call:end', {
            uniqueid: event.Uniqueid,
            channel: event.Channel,
            cause: event.Cause,
            causeTxt: event['Cause-txt'],
            duration: event.Duration,
            timestamp: new Date().toISOString(),
        });
    });

    // ── Dial completed (success / failure / busy / etc.) ─────
    amiClient.on('DialEnd', (event) => {
        logger.debug('AMI event: DialEnd', { dialstatus: event.DialStatus });
        const status = event.DialStatus?.toUpperCase();
        if (status && status !== 'ANSWER') {
            asteriskEvents.emit('call:failed', {
                uniqueid: event.Uniqueid,
                dialStatus: status,
                timestamp: new Date().toISOString(),
            });
        }
    });
}

/**
 * originateCall(fromExtension, toPhone)
 * Instructs Asterisk to place an outbound call.
 *
 * Flow: Asterisk calls `fromExtension` (manager's SIP phone) first,
 * waits for them to answer, then dials `toPhone` (customer).
 *
 * @param {string} fromExtension  - Internal SIP extension (e.g. "101")
 * @param {string} toPhone        - Customer's phone number (e.g. "+79001234567")
 * @returns {Promise<{actionId: string, callId: string}>}
 */
async function originateCall(fromExtension, toPhone) {
    if (!amiClient || !connected) {
        throw new Error('Not connected to Asterisk AMI');
    }

    const actionId = uuidv4();
    const context = process.env.ASTERISK_CONTEXT || 'from-internal';
    const priority = process.env.ASTERISK_PRIORITY || '1';

    // Clean phone number: keep leading + and digits only
    const cleanPhone = toPhone.replace(/[^\d+]/g, '');

    const action = {
        Action: 'Originate',
        ActionID: actionId,
        Channel: `PJSIP/${fromExtension}`,
        Context: context,
        Exten: cleanPhone,
        Priority: priority,
        CallerID: `CRM <${fromExtension}>`,
        Timeout: 30000,   // ms to wait for answer
        Async: 'yes',     // don't block the AMI connection
        Variable: `CRM_CALL_ID=${actionId}`, // pass through for CDR
    };

    logger.info('Originating call', {
        from: fromExtension,
        to: cleanPhone,
        actionId,
    });

    try {
        await amiClient.action(action);
        pendingCalls.set(actionId, {
            from: fromExtension,
            to: cleanPhone,
            startedAt: new Date().toISOString(),
        });
        return { actionId, callId: actionId };
    } catch (err) {
        logger.error('Failed to originate call', { error: err.message, actionId });
        throw err;
    }
}

/**
 * hangupCall(channel)
 * Hangs up an active call channel.
 *
 * @param {string} channel - Asterisk channel name (e.g. "PJSIP/101-0000001")
 */
async function hangupCall(channel) {
    if (!amiClient || !connected) {
        throw new Error('Not connected to Asterisk AMI');
    }
    logger.info('Hanging up channel', { channel });
    await amiClient.action({
        Action: 'Hangup',
        Channel: channel,
        Cause: 16, // Normal clearing
    });
}

/**
 * getActiveCalls()
 * Returns a list of currently active calls via the "CoreShowChannels" action.
 *
 * @returns {Promise<Array>}
 */
async function getActiveCalls() {
    if (!amiClient || !connected) {
        throw new Error('Not connected to Asterisk AMI');
    }
    const response = await amiClient.action({ Action: 'CoreShowChannels' });
    return Array.isArray(response) ? response : [response];
}

/**
 * isConnected()
 * Returns the current connection state.
 */
function isConnected() {
    return connected;
}

/**
 * disconnect()
 * Gracefully closes the AMI connection. Call on server shutdown.
 */
async function disconnect() {
    if (amiClient) {
        try {
            await amiClient.disconnect();
            connected = false;
            logger.info('Disconnected from Asterisk AMI');
        } catch (err) {
            logger.warn('Error during AMI disconnect', { error: err.message });
        }
    }
}

module.exports = {
    connect,
    disconnect,
    isConnected,
    originateCall,
    hangupCall,
    getActiveCalls,
    asteriskEvents, // other services listen to these events
};
