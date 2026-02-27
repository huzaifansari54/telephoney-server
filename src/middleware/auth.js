// src/middleware/auth.js
// API key authentication middleware.
// Every request to /api/* must include the header:
//   x-api-key: <your-api-key>
// The key is compared against the API_KEY environment variable.

const logger = require('../utils/logger');

/**
 * validateApiKey
 * Express middleware that checks the x-api-key header.
 */
function validateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        logger.warn('API request rejected — missing x-api-key header', {
            ip: req.ip,
            path: req.path,
        });
        return res.status(401).json({
            success: false,
            error: 'Unauthorized',
            message: 'Missing x-api-key header',
        });
    }

    const validKey = process.env.API_KEY;

    if (!validKey) {
        logger.error('API_KEY environment variable is not set — refusing all requests');
        return res.status(500).json({
            success: false,
            error: 'Server configuration error',
            message: 'API key not configured on server',
        });
    }

    // Constant-time comparison to prevent timing attacks
    const crypto = require('crypto');
    const provided = Buffer.from(apiKey);
    const expected = Buffer.from(validKey);

    let valid = false;
    try {
        // timingSafeEqual throws if buffers are different length
        valid =
            provided.length === expected.length &&
            crypto.timingSafeEqual(provided, expected);
    } catch {
        valid = false;
    }

    if (!valid) {
        logger.warn('API request rejected — invalid API key', {
            ip: req.ip,
            path: req.path,
        });
        return res.status(401).json({
            success: false,
            error: 'Unauthorized',
            message: 'Invalid API key',
        });
    }

    next();
}

module.exports = { validateApiKey };
