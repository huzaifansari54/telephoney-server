// src/services/callManager.js
// High-level call management: tracks in-progress calls, manages state
// transitions, and forwards events to Supabase via webhook.
//
// Acts as a bridge between:
//   asterisk.js  (raw AMI events)  ──► callManager.js ──► webhooks.js → Supabase
//
// OnlinePBX event name mapping:
//   Asterisk 'call:start'    → 'call_start'
//   Asterisk 'call:ringing'  → 'call_ringing'
//   Asterisk 'call:answered' → 'call_answered'
//   Asterisk 'call:end'      → 'call_end'
//   Asterisk 'call:failed'   → 'call_failed'

const axios = require('axios');
const logger = require('../utils/logger');
const { asteriskEvents } = require('./asterisk');

// In-memory call store (uniqueid → call data)
// In production you could persist this to Redis/DB for multi-node support
const activeCalls = new Map();

/**
 * init()
 * Start listening to Asterisk events and forward to Supabase.
 * Call this once after the AMI connection is established.
 */
function init() {
    asteriskEvents.on('call:start', _onCallStart);
    asteriskEvents.on('call:ringing', _onCallRinging);
    asteriskEvents.on('call:answered', _onCallAnswered);
    asteriskEvents.on('call:end', _onCallEnd);
    asteriskEvents.on('call:failed', _onCallFailed);
    logger.info('Call Manager initialized — listening for Asterisk events');
}

// ─── Internal Handlers ────────────────────────────────────────────────────────

function _onCallStart(data) {
    activeCalls.set(data.uniqueid, {
        uniqueid: data.uniqueid,
        channel: data.channel,
        caller: data.callerIdNum,
        callee: data.exten,
        direction: _guessDirection(data.callerIdNum, data.exten),
        status: 'started',
        startedAt: data.timestamp,
        answeredAt: null,
        endedAt: null,
        duration: 0,
        recordingUrl: null,
    });

    _forwardToSupabase('call_start', data.uniqueid, {
        event: 'call_start',
        call_id: data.uniqueid,
        caller: data.callerIdNum,
        callee: data.exten,
        direction: _guessDirection(data.callerIdNum, data.exten),
        timestamp: data.timestamp,
    });
}

function _onCallRinging(data) {
    const call = activeCalls.get(data.uniqueid);
    if (call) {
        call.status = 'ringing';
        activeCalls.set(data.uniqueid, call);
    }

    _forwardToSupabase('call_ringing', data.uniqueid, {
        event: 'call_ringing',
        call_id: data.uniqueid,
        timestamp: data.timestamp,
    });
}

function _onCallAnswered(data) {
    const call = activeCalls.get(data.uniqueid);
    if (call) {
        call.status = 'answered';
        call.answeredAt = data.timestamp;
        activeCalls.set(data.uniqueid, call);
    }

    _forwardToSupabase('call_answered', data.uniqueid, {
        event: 'call_answered',
        call_id: data.uniqueid,
        timestamp: data.timestamp,
    });
}

function _onCallEnd(data) {
    const call = activeCalls.get(data.uniqueid);
    const endedCall = call || {};

    const finalCall = {
        ...endedCall,
        status: 'ended',
        endedAt: data.timestamp,
        duration: parseInt(data.duration || '0', 10),
        hangupCause: data.cause,
        hangupCauseTxt: data.causeTxt,
    };

    _forwardToSupabase('call_end', data.uniqueid, {
        event: 'call_end',
        call_id: data.uniqueid,
        caller: finalCall.caller,
        callee: finalCall.callee,
        direction: finalCall.direction,
        duration: finalCall.duration,
        status: _mapHangupCause(data.cause),
        hangup_cause: data.cause,
        hangup_cause_txt: data.causeTxt,
        started_at: finalCall.startedAt,
        answered_at: finalCall.answeredAt,
        ended_at: data.timestamp,
        recording_url: finalCall.recordingUrl || null,
        timestamp: data.timestamp,
    });

    // Keep for a short time for recording upload, then clean up
    setTimeout(() => activeCalls.delete(data.uniqueid), 60 * 1000);
}

function _onCallFailed(data) {
    const call = activeCalls.get(data.uniqueid);

    _forwardToSupabase('call_failed', data.uniqueid, {
        event: 'call_failed',
        call_id: data.uniqueid,
        caller: call?.caller,
        callee: call?.callee,
        direction: call?.direction,
        status: 'failed',
        dial_status: data.dialStatus,
        timestamp: data.timestamp,
    });

    activeCalls.delete(data.uniqueid);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * _forwardToSupabase()
 * POST event data to the Supabase telephony-webhook edge function.
 * This replaces the webhook that OnlinePBX used to send.
 */
async function _forwardToSupabase(eventName, callId, payload) {
    const webhookUrl = process.env.SUPABASE_WEBHOOK_URL;
    if (!webhookUrl) {
        logger.warn('SUPABASE_WEBHOOK_URL not set — skipping webhook forward', { eventName, callId });
        return;
    }

    try {
        await axios.post(webhookUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                // Supabase Edge Functions accept the service key in Authorization header
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            },
            timeout: 10000,
        });
        logger.info('Forwarded event to Supabase', { eventName, callId });
    } catch (err) {
        logger.error('Failed to forward event to Supabase', {
            eventName,
            callId,
            error: err.message,
            status: err.response?.status,
        });
        // Do NOT throw — a failed webhook should not crash the call manager
    }
}

/**
 * _guessDirection()
 * Heuristic: if the caller ID looks like an extension (short number),
 * the call is outbound (manager → customer).
 */
function _guessDirection(caller, callee) {
    if (!caller) return 'unknown';
    const isExtension = /^\d{2,4}$/.test(caller);
    return isExtension ? 'outbound' : 'inbound';
}

/**
 * _mapHangupCause()
 * Maps Asterisk Q.931 hangup causes to human-readable status strings
 * compatible with what OnlinePBX returned.
 *
 * Full cause list: https://www.voip-info.org/asterisk-variable-hangupcause/
 */
function _mapHangupCause(cause) {
    const code = parseInt(cause, 10);
    if (code === 16) return 'answered';       // Normal clearing
    if (code === 17) return 'busy';           // User busy
    if (code === 18) return 'no_answer';      // No user responding
    if (code === 19) return 'no_answer';      // No answer from user
    if (code === 20) return 'missed';         // Subscriber absent
    if (code === 21) return 'rejected';       // Call rejected
    if ([1, 3, 22, 28, 38].includes(code)) return 'failed'; // Various failures
    return 'ended';
}

/**
 * getActiveCall(uniqueid)
 * Returns current state of an in-progress call.
 */
function getActiveCall(uniqueid) {
    return activeCalls.get(uniqueid) || null;
}

/**
 * getAllActiveCalls()
 * Returns all currently tracked calls.
 */
function getAllActiveCalls() {
    return Array.from(activeCalls.values());
}

/**
 * updateRecordingUrl(uniqueid, url)
 * Called by recordings.js after a recording is uploaded to Supabase Storage.
 */
function updateRecordingUrl(uniqueid, url) {
    const call = activeCalls.get(uniqueid);
    if (call) {
        call.recordingUrl = url;
        activeCalls.set(uniqueid, call);
        logger.info('Recording URL updated for call', { uniqueid, url });
    }
}

module.exports = {
    init,
    getActiveCall,
    getAllActiveCalls,
    updateRecordingUrl,
};
