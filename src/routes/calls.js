// src/routes/calls.js
// Handles all call-related endpoints:
//
//   POST /api/call/now       — Initiate an outbound call (replaces OnlinePBX /call/now.json)
//   GET  /api/call/active    — List currently active calls
//   POST /api/call/hangup    — Hang up a specific call
//   GET  /api/user           — Server/user info (replaces OnlinePBX /user/get.json)
//
// The CRM's telephony-callback Supabase Edge Function calls POST /api/call/now
// with the same body structure previously sent to OnlinePBX.

const router = require('express').Router();
const { originateCall, hangupCall, getActiveCalls } = require('../services/asterisk');
const callManager = require('../services/callManager');
const logger = require('../utils/logger');

// ─── POST /api/call/now ───────────────────────────────────────────────────────
// Initiate an outbound call.
//
// Request body:
//   {
//     "from": "101",              // Manager's SIP extension
//     "to":   "+79001234567"      // Customer's phone number
//   }
//
// Success response (same format as OnlinePBX /call/now.json):
//   { "status": 1, "data": { "call_id": "<uuid>" } }
//
// Error response:
//   { "status": 0, "comment": "Error message" }
//
router.post('/now', async (req, res) => {
    const { from, to } = req.body;

    // ── Validation ─────────────────────────────────────────────
    if (!from || !to) {
        logger.warn('Call request missing required fields', { from, to });
        return res.status(400).json({
            status: 0,
            comment: 'Missing required fields: from (extension) and to (phone number)',
        });
    }

    const fromStr = String(from).trim();
    const toStr = String(to).trim();

    if (!/^\d{2,6}$/.test(fromStr)) {
        return res.status(400).json({
            status: 0,
            comment: `Invalid extension format: "${fromStr}". Must be 2-6 digits.`,
        });
    }

    if (!/^[\d+\-\s()]{5,20}$/.test(toStr)) {
        return res.status(400).json({
            status: 0,
            comment: `Invalid phone number format: "${toStr}"`,
        });
    }

    // ── Originate ──────────────────────────────────────────────
    try {
        const { callId, actionId } = await originateCall(fromStr, toStr);

        logger.info('Call originated successfully', { from: fromStr, to: toStr, callId });

        // Return OnlinePBX-compatible response format
        return res.json({
            status: 1,
            data: {
                call_id: callId,
                action_id: actionId,
                from: fromStr,
                to: toStr,
                initiated_at: new Date().toISOString(),
            },
        });
    } catch (err) {
        logger.error('Failed to originate call', {
            from: fromStr,
            to: toStr,
            error: err.message,
        });

        return res.status(500).json({
            status: 0,
            comment: err.message || 'Failed to initiate call',
        });
    }
});

// ─── GET /api/call/active ─────────────────────────────────────────────────────
// Returns all currently tracked active calls (in-memory state).
//
router.get('/active', async (req, res) => {
    try {
        const calls = callManager.getAllActiveCalls();
        res.json({
            success: true,
            count: calls.length,
            data: calls,
        });
    } catch (err) {
        logger.error('Failed to get active calls', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── POST /api/call/hangup ────────────────────────────────────────────────────
// Hang up a specific channel.
//
// Request body:
//   { "channel": "PJSIP/101-0000001" }
//
router.post('/hangup', async (req, res) => {
    const { channel } = req.body;

    if (!channel) {
        return res.status(400).json({
            success: false,
            error: 'Missing required field: channel',
        });
    }

    try {
        await hangupCall(channel);
        logger.info('Call hung up via API', { channel });
        res.json({ success: true, message: `Channel ${channel} hungup` });
    } catch (err) {
        logger.error('Failed to hangup call', { channel, error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── GET /api/user ────────────────────────────────────────────────────────────
// Returns server / user information.
// Replaces OnlinePBX's GET /user/get.json — used by CRM to test connectivity.
//
router.get('/user', (req, res) => {
    res.json({
        status: 1,
        data: {
            id: 'satubooster-pbx',
            name: 'SatuBooster PBX',
            type: 'pbx_api',
            version: '1.0.0',
            features: ['outbound_calls', 'call_history', 'webhooks', 'recordings'],
        },
    });
});

module.exports = router;
