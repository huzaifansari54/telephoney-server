// src/services/recordings.js
// Handles call recording files:
//   1. Watches Asterisk's recording output directory for new .wav / .mp3 files
//   2. Uploads completed recordings to Supabase Storage
//   3. Updates the call record with the public recording URL
//   4. (Optionally) deletes local file after successful upload to save disk space

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');
const callManager = require('./callManager');

// ─── Supabase client (service role — can write to Storage) ───────────────────
let supabase = null;

function _getSupabase() {
    if (!supabase) {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_KEY;
        if (!url || !key) {
            logger.warn('Supabase not configured — recording uploads disabled');
            return null;
        }
        supabase = createClient(url, key);
    }
    return supabase;
}

// ─── Active directory watcher ─────────────────────────────────────────────────
let watcher = null;

/**
 * startWatcher()
 * Watches the Asterisk recordings directory for new .mp3 / .wav files.
 * When a new recording appears, uploads it to Supabase Storage.
 */
function startWatcher() {
    const recordingsPath = process.env.ASTERISK_RECORDINGS_PATH;

    if (!recordingsPath) {
        logger.warn(
            'ASTERISK_RECORDINGS_PATH not set — recording auto-upload disabled'
        );
        return;
    }

    if (!fs.existsSync(recordingsPath)) {
        logger.warn(`Recordings path does not exist: ${recordingsPath}`);
        logger.warn('Recording auto-upload disabled — create the directory on your VPS');
        return;
    }

    logger.info(`Watching for new recordings in: ${recordingsPath}`);

    watcher = fs.watch(recordingsPath, { recursive: true }, async (eventType, filename) => {
        if (eventType !== 'rename' || !filename) return;

        const ext = path.extname(filename).toLowerCase();
        if (!['.mp3', '.wav'].includes(ext)) return;

        const fullPath = path.join(recordingsPath, filename);

        // Wait a moment for the file to be fully written by Asterisk
        await _wait(2000);

        if (!fs.existsSync(fullPath)) return; // file was deleted, not created

        logger.info(`New recording detected: ${filename}`);
        await uploadRecording(fullPath, filename);
    });

    watcher.on('error', (err) => {
        logger.error('Recording watcher error', { error: err.message });
    });
}

/**
 * stopWatcher()
 * Stops the directory watcher. Call on server shutdown.
 */
function stopWatcher() {
    if (watcher) {
        watcher.close();
        watcher = null;
        logger.info('Recording watcher stopped');
    }
}

/**
 * uploadRecording(localFilePath, filename)
 * Uploads a recording file to Supabase Storage and returns the public URL.
 *
 * File naming convention: Asterisk creates files like:
 *   q-CRM_CALL_ID-20240223-143022-1234567890.123.mp3
 * We extract the CRM_CALL_ID from the filename to link it to the right call.
 *
 * @param {string} localFilePath  - Absolute path to the local recording file
 * @param {string} filename       - Just the filename (for storage path)
 * @returns {Promise<string|null>} - Public URL or null on failure
 */
async function uploadRecording(localFilePath, filename) {
    const sb = _getSupabase();
    if (!sb) return null;

    const bucket = process.env.RECORDINGS_BUCKET || 'call-recordings';

    let fileBuffer;
    try {
        fileBuffer = fs.readFileSync(localFilePath);
    } catch (err) {
        logger.error('Could not read recording file', { localFilePath, error: err.message });
        return null;
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === '.mp3' ? 'audio/mpeg' : 'audio/wav';
    const storagePath = filename; // keep original filename in storage

    try {
        const { error: uploadError } = await sb.storage
            .from(bucket)
            .upload(storagePath, fileBuffer, {
                contentType,
                upsert: true,
            });

        if (uploadError) {
            logger.error('Supabase Storage upload failed', { error: uploadError.message, filename });
            return null;
        }

        // Get public URL
        const { data: { publicUrl } } = sb.storage
            .from(bucket)
            .getPublicUrl(storagePath);

        logger.info('Recording uploaded to Supabase Storage', { filename, publicUrl });

        // Try to link to the in-memory call via uniqueid extracted from filename
        const callId = _extractCallIdFromFilename(filename);
        if (callId) {
            callManager.updateRecordingUrl(callId, publicUrl);
        }

        // Optionally: delete local file to save disk space
        if (process.env.DELETE_LOCAL_RECORDINGS === 'true') {
            try {
                fs.unlinkSync(localFilePath);
                logger.debug('Local recording deleted after upload', { localFilePath });
            } catch (err) {
                logger.warn('Could not delete local recording', { error: err.message });
            }
        }

        return publicUrl;
    } catch (err) {
        logger.error('Unexpected error during recording upload', { error: err.message, filename });
        return null;
    }
}

/**
 * _extractCallIdFromFilename()
 * Extraisk typically names files: <callid>-<timestamp>.<ext>
 * We look for a UUID-like pattern OR the CRM_CALL_ID variable we pass.
 */
function _extractCallIdFromFilename(filename) {
    // UUID pattern
    const uuidMatch = filename.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
    if (uuidMatch) return uuidMatch[0];

    // Asterisk uniqueid pattern: digits.digits (e.g. 1708693822.12)
    const uniqueidMatch = filename.match(/(\d+\.\d+)/);
    if (uniqueidMatch) return uniqueidMatch[1];

    return null;
}

function _wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
    startWatcher,
    stopWatcher,
    uploadRecording,
};
