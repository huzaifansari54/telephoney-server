// src/routes/webhooks.js
// POST /api/webhook — Receive call events from Asterisk (via AMI event forwarding)
// and from external services (e.g. Telnyx SIP trunk webhooks).
//
// This endpoint can also be polled by or called from external monitoring tools.
//
// Two sources of incoming webhook data:
//   1. Internal: triggered by asterisk.js → callManager.js → this route (optional)
//   2. External: SIP trunk provider (e.g. Telnyx) sends HTTP webhooks for SMS,
//      call status updates, etc. These are forwarded to Supabase.
//
// The route validates the request and re-forwards to Supabase
// telephony-webhook Edge Function using the same format the CRM already
// understands (previously sent by OnlinePBX).

const router = require('express').Router();
const axios = require('axios');
const logger = require('../utils/logger');

// ─── POST /api/webhook ────────────────────────────────────────────────────────
// Receives a call event and forwards it to the Supabase Edge Function.
//
// Expected body:
//   {
//     "event": "call_start" | "call_ringing" | "call_answered" | "call_end" | "call_failed",
//     "call_id": "string",
//     "caller": "+79001234567",
//     "callee": "+79007654321",
//     "direction": "inbound" | "outbound",
//     "duration": 120,
//     "status": "answered" | "missed" | "busy" | "failed",
//     "recording_url": "https://..." (optional),
//     "timestamp": "ISO string"
//   }
//
router.post('/', async (req, res) => {
    const payload = req.body;

    if (!payload || !payload.event) {
        return res.status(400).json({
            success: false,
            error: 'Missing required field: event',
        });
    }

    const validEvents = [
        'call_start',
        'call_ringing',
        'call_answered',
        'call_end',
        'call_failed',
        'call_missed',
    ];

    if (!validEvents.includes(payload.event)) {
        return res.status(400).json({
            success: false,
            error: `Unknown event type: "${payload.event}". Valid events: ${validEvents.join(', ')}`,
        });
    }

    logger.info('Webhook received', {
        event: payload.event,
        call_id: payload.call_id,
        direction: payload.direction,
    });

    // ── Forward to Supabase ──────────────────────────────────────────────────
    const forwarded = await _forwardToSupabase(payload);

    res.json({
        success: true,
        forwarded_to_supabase: forwarded,
        event: payload.event,
        call_id: payload.call_id,
        received_at: new Date().toISOString(),
    });
});

// ─── POST /api/webhook/telnyx ─────────────────────────────────────────────────
// Dedicated endpoint for Telnyx SIP trunk webhooks.
// Telnyx sends call status updates in their own format; we normalize and
// forward to Supabase.
//
// Telnyx webhook docs: https://developers.telnyx.com/docs/v2/call-control/webhooks
//
router.post('/telnyx', async (req, res) => {
    const body = req.body;

    // Telnyx sends { "data": { "event_type": "...", "payload": {...} } }
    const eventType = body?.data?.event_type;
    const payload = body?.data?.payload;

    if (!eventType || !payload) {
        return res.status(400).json({
            success: false,
            error: 'Invalid Telnyx webhook format',
        });
    }

    logger.info('Telnyx webhook received', { eventType, callControlId: payload.call_control_id });

    // Map Telnyx event → our internal format
    const normalized = _normalizeTelnyxEvent(eventType, payload);
    if (!normalized) {
        // Event we don't care about — acknowledge and ignore
        return res.json({ success: true, ignored: true, eventType });
    }

    const forwarded = await _forwardToSupabase(normalized);

    res.json({
        success: true,
        forwarded_to_supabase: forwarded,
        event: normalized.event,
        call_id: normalized.call_id,
    });
});

// ─── GET /api/webhook/health ──────────────────────────────────────────────────
// Simple health check for this route. Used by UptimeRobot etc.
//
router.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'ok',
        timestamp: new Date().toISOString(),
    });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function _forwardToSupabase(payload) {
    const webhookUrl = process.env.SUPABASE_WEBHOOK_URL;
    if (!webhookUrl) {
        logger.warn('SUPABASE_WEBHOOK_URL not set — not forwarding to Supabase');
        return false;
    }

    try {
        const response = await axios.post(webhookUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            },
            timeout: 10000,
        });
        logger.info('Event forwarded to Supabase', {
            event: payload.event,
            supabaseStatus: response.status,
        });
        return true;
    } catch (err) {
        logger.error('Failed to forward event to Supabase', {
            event: payload.event,
            error: err.message,
            status: err.response?.status,
        });
        return false;
    }
}

/**
 * _normalizeTelnyxEvent()
 * Translates a Telnyx event type + payload into our standard webhook format.
 * Returns null if the event should be ignored.
 *
 * Telnyx event types:
 *   call.initiated        → call_start
 *   call.answered         → call_answered
 *   call.hangup           → call_end
 *   call.playback.started → (ignored)
 *   etc.
 */
function _normalizeTelnyxEvent(eventType, payload) {
    const callId = payload.call_leg_id || payload.call_control_id || 'unknown';
    const timestamp = new Date().toISOString();

    switch (eventType) {
        case 'call.initiated':
            return {
                event: 'call_start',
                call_id: callId,
                caller: payload.from,
                callee: payload.to,
                direction: payload.direction || 'outbound',
                timestamp,
            };

        case 'call.answered':
            return {
                event: 'call_answered',
                call_id: callId,
                caller: payload.from,
                callee: payload.to,
                timestamp,
            };

        case 'call.hangup':
            return {
                event: 'call_end',
                call_id: callId,
                caller: payload.from,
                callee: payload.to,
                duration: payload.billable_seconds || 0,
                status: payload.hangup_cause === 'ORIGINATOR_CANCEL' ? 'missed' : 'answered',
                hangup_cause: payload.hangup_cause,
                timestamp,
            };

        default:
            return null; // ignore unknown events
    }
}

module.exports = router;
