// src/routes/auth.js
// POST /api/auth
//
// Validates the x-api-key and confirms the server is reachable.
// This directly replaces OnlinePBX's /auth.json endpoint.
//
// The CRM's telephony-callback edge function calls this to verify
// that the API key is valid before attempting to make a call.
//
// Request:
//   POST /api/auth
//   Headers: x-api-key: <key>
//
// Response (success):
//   { "success": true, "message": "Authenticated", "server": "SatuBooster PBX" }
//
// Response (failure):
//   401 { "success": false, "error": "Unauthorized", "message": "Invalid API key" }

const router = require('express').Router();
const asterisk = require('../services/asterisk');
const logger = require('../utils/logger');

// POST /api/auth — validate API key and return server info
// Note: validateApiKey middleware ALREADY ran before this handler,
// so if we reach here, the key is valid.
router.post('/', (req, res) => {
    logger.info('Auth check passed', { ip: req.ip });

    res.json({
        success: true,
        message: 'Authenticated',
        server: 'SatuBooster PBX',
        version: '1.0.0',
        asterisk_connected: asterisk.isConnected(),
        timestamp: new Date().toISOString(),
    });
});

// GET /api/auth — also support GET for "test connection" button in CRM Settings
router.get('/', (req, res) => {
    logger.info('Auth check (GET) passed', { ip: req.ip });

    res.json({
        success: true,
        message: 'Authenticated',
        server: 'SatuBooster PBX',
        version: '1.0.0',
        asterisk_connected: asterisk.isConnected(),
        timestamp: new Date().toISOString(),
    });
});

module.exports = router;
