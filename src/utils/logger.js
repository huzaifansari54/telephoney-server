// src/utils/logger.js
// Centralized Winston logger for the telephony server.
// Logs to console (development) and rotating log files (production).

const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const LOG_DIR = path.resolve(process.env.LOG_DIR || 'logs');
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const { combine, timestamp, printf, colorize, errors, json } = format;

// Pretty format for console output
const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
    let msg = `${timestamp} [${level}] ${message}`;
    if (stack) msg += `\n${stack}`;
    const extras = Object.keys(meta).length ? `\n  ${JSON.stringify(meta, null, 2)}` : '';
    return msg + extras;
});

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { service: 'telephony-server' },

    format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    ),

    transports: [
        // ── Console ──────────────────────────────────────────────
        new transports.Console({
            format: combine(
                colorize({ all: true }),
                timestamp({ format: 'HH:mm:ss' }),
                consoleFormat,
            ),
        }),

        // ── Combined log file ─────────────────────────────────────
        new transports.File({
            filename: path.join(LOG_DIR, 'combined.log'),
            format: combine(json()),
            maxsize: 10 * 1024 * 1024, // 10 MB
            maxFiles: 5,
            tailable: true,
        }),

        // ── Error-only log file ───────────────────────────────────
        new transports.File({
            level: 'error',
            filename: path.join(LOG_DIR, 'error.log'),
            format: combine(json()),
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
            tailable: true,
        }),
    ],
});

// Stream for Morgan HTTP request logging (if used)
logger.stream = {
    write: (message) => logger.http(message.trim()),
};

module.exports = logger;
