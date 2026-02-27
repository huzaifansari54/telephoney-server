// src/index.js
// SatuBooster Telephony Server — Express Application Entry Point
//
// This server replaces the OnlinePBX API dependency in the SatuBooster CRM.
// It acts as a bridge between:
//   CRM Frontend → Supabase Edge Functions → THIS SERVER → FreePBX/Asterisk → Real Phone Network
//
// Startup sequence:
//   1. Load environment variables
//   2. Create Express app with security middleware
//   3. Connect to Asterisk AMI
//   4. Initialize call manager (event forwarding to Supabase)
//   5. Start recording file watcher
//   6. Start HTTP server

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
const { validateApiKey } = require('./middleware/auth');
const asterisk = require('./services/asterisk');
const callManager = require('./services/callManager');
const recordings = require('./services/recordings');

// ─── App ──────────────────────────────────────────────────────────────────────
const app = express();

// ─── Security headers (helmet) ───────────────────────────────────────────────
app.use(
    helmet({
        contentSecurityPolicy: false, // Not a browser-facing app
        crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : '*';

app.use(
    cors({
        origin: allowedOrigins,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
    })
);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Applies to all /api/* routes to protect against abuse
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15-minute window
    max: 200,                    // 200 requests per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many requests — please try again later',
    },
    skip: (req) => {
        // Don't rate-limit the health check endpoints
        return req.path === '/health' || req.path === '/api/webhook/health';
    },
});

app.use('/api/', apiLimiter);

// ─── Request logging ──────────────────────────────────────────────────────────
app.use((req, _res, next) => {
    logger.http(`${req.method} ${req.path}`, { ip: req.ip });
    next();
});

// ─── Public Routes (no auth required) ────────────────────────────────────────

// Health check — used by UptimeRobot, load balancers, PM2
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'satubooster-telephony',
        version: '1.0.0',
        asterisk_connected: asterisk.isConnected(),
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
    });
});

// Root — friendly message
app.get('/', (_req, res) => {
    res.json({
        service: 'SatuBooster Telephony Server',
        version: '1.0.0',
        docs: 'See plan.md for API documentation',
        health: '/health',
        api: '/api/*  (requires x-api-key header)',
    });
});

// Telnyx webhooks don't send x-api-key, so this route bypasses auth middleware
// (Telnyx signs requests with a different mechanism — add signature validation here if needed)
app.use('/api/webhook/telnyx', require('./routes/webhooks'));

// ─── Protected Routes (require x-api-key) ────────────────────────────────────
// All routes below this middleware require a valid API key
app.use('/api', validateApiKey);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/call', require('./routes/calls'));
app.use('/api/user', require('./routes/calls')); // /api/user is on the calls router too
app.use('/api/history', require('./routes/history'));
app.use('/api/webhook', require('./routes/webhooks'));

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
    logger.warn('Route not found', { method: req.method, path: req.path });
    res.status(404).json({
        success: false,
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} does not exist`,
    });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
    logger.error('Unhandled Express error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
    });
    res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);

async function start() {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('   SatuBooster Telephony Server starting…');
    logger.info(`   Environment : ${process.env.NODE_ENV || 'development'}`);
    logger.info(`   Port        : ${PORT}`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // ── Connect to Asterisk AMI ──────────────────────────────────
    // Non-fatal: asterisk.connect() handles its own errors internally
    // and schedules retries. Server starts regardless.
    await asterisk.connect();

    // ── Initialize call manager ───────────────────────────────────
    callManager.init();

    // ── Start recording watcher ───────────────────────────────────
    recordings.startWatcher();

    // ── Start HTTP server ─────────────────────────────────────────
    const server = app.listen(PORT);

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger.error(`❌ Port ${PORT} is already in use. Kill the process using it or change PORT in .env`);
        } else {
            logger.error('Server error', { error: err.message });
        }
        process.exit(1);
    });

    server.on('listening', () => {
        logger.info(`✅ Server listening on http://0.0.0.0:${PORT}`);
        logger.info('   Endpoints:');
        logger.info('   GET  /health              — Health check (no auth)');
        logger.info('   POST /api/auth            — Validate API key');
        logger.info('   POST /api/call/now        — Initiate outbound call');
        logger.info('   GET  /api/call/active     — List active calls');
        logger.info('   POST /api/call/hangup     — Hang up a call');
        logger.info('   GET  /api/history         — Call history (CDR)');
        logger.info('   POST /api/webhook         — Receive call events');
        logger.info('   POST /api/webhook/telnyx  — Telnyx SIP webhooks');
        logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    });

    // ── Graceful shutdown ─────────────────────────────────────────
    const shutdown = async (signal) => {
        logger.info(`Received ${signal} — shutting down gracefully…`);

        server.close(async () => {
            recordings.stopWatcher();
            await asterisk.disconnect();
            logger.info('Server shut down cleanly. Goodbye!');
            process.exit(0);
        });

        // Force shutdown after 10 seconds
        setTimeout(() => {
            logger.error('Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Catch unhandled promise rejections (don't crash the server)
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled promise rejection', {
            reason: reason?.message || reason,
            promise: String(promise),
        });
    });
}

start();
