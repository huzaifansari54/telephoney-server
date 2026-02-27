// src/routes/history.js
// GET /api/history — Returns call history.
//
// Replaces OnlinePBX's GET /history/search.json endpoint.
// The CRM's Telephony page calls this to display the call log.
//
// Data source: Asterisk's CDR (Call Detail Records) stored in MariaDB.
// FreePBX automatically writes CDR to the `asteriskcdrdb`.`cdr` table.
//
// Query Parameters (all optional):
//   start      — ISO date string (default: 7 days ago)
//   end        — ISO date string (default: now)
//   limit      — number of records (default: 50, max: 500)
//   offset     — pagination offset (default: 0)
//   extension  — filter by SIP extension
//   phone      — filter by customer phone number
//   status     — filter by status: answered|missed|busy|failed
//
// Response format mirrors OnlinePBX /history/search.json for minimal CRM changes.

const router = require('express').Router();
const logger = require('../utils/logger');

// ─── Optional: MySQL/MariaDB CDR access ──────────────────────────────────────
// Uncomment and configure this section if you want to query the actual
// Asterisk CDR database for persistent history.
// Requires: npm install mysql2
//
// const mysql = require('mysql2/promise');
// let dbPool = null;
// function getDb() {
//   if (!dbPool) {
//     dbPool = mysql.createPool({
//       host:     process.env.CDR_DB_HOST || '127.0.0.1',
//       port:     parseInt(process.env.CDR_DB_PORT || '3306', 10),
//       user:     process.env.CDR_DB_USER || 'asteriskcdrdb',
//       password: process.env.CDR_DB_PASSWORD,
//       database: process.env.CDR_DB_NAME || 'asteriskcdrdb',
//     });
//   }
//   return dbPool;
// }

// ─── GET /api/history ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const {
        start,
        end,
        limit = '50',
        offset = '0',
        extension,
        phone,
        status,
    } = req.query;

    const limitNum = Math.min(parseInt(limit, 10) || 50, 500);
    const offsetNum = parseInt(offset, 10) || 0;

    const startDate = start
        ? new Date(start)
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const endDate = end ? new Date(end) : new Date();

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({
            success: false,
            error: 'Invalid date format for start or end',
        });
    }

    logger.info('Call history requested', {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        limit: limitNum,
        offset: offsetNum,
        extension,
        phone,
        status,
    });

    // ── CDR Database Query (FreePBX MariaDB) ─────────────────────────────────
    // TODO: Uncomment the MySQL block at the top of this file and replace this
    //       placeholder with the real CDR query when your FreePBX is running.
    //
    // The `cdr` table schema (standard Asterisk):
    //   calldate    DATETIME    — when the call started
    //   clid        VARCHAR     — caller ID string "Name <number>"
    //   src         VARCHAR     — source (callerID number)
    //   dst         VARCHAR     — destination (dialed number)
    //   dcontext    VARCHAR     — dialplan context
    //   channel     VARCHAR     — Asterisk channel
    //   dstchannel  VARCHAR     — destination channel
    //   lastapp     VARCHAR     — last application executed
    //   lastdata    VARCHAR     — last app arguments
    //   duration    INT         — total call duration in seconds
    //   billsec     INT         — billable seconds (answer → hangup)
    //   disposition VARCHAR     — ANSWERED | NO ANSWER | BUSY | FAILED
    //   amaflags    INT         — AMA flags
    //   accountcode VARCHAR     — account code
    //   userfield   VARCHAR     — user-defined field
    //   uniqueid    VARCHAR     — unique call identifier ← our call_id
    //   linkedid    VARCHAR     — linked call ID
    //   sequence    INT         — channel sequence number
    //   peeraccount VARCHAR     — peer account code
    //
    // Example query:
    //   SELECT * FROM cdr
    //   WHERE calldate BETWEEN ? AND ?
    //   AND (src = ? OR dst LIKE ?)
    //   ORDER BY calldate DESC
    //   LIMIT ? OFFSET ?

    try {
        // ── PLACEHOLDER: return mock data until CDR DB is configured ────────────
        // Remove this block and replace with CDR query above in production.
        const mockRecords = _generateMockHistory({
            startDate,
            endDate,
            limitNum,
            offsetNum,
            extension,
            phone,
            status,
        });

        return res.json({
            status: 1,
            data: mockRecords,
            pagination: {
                limit: limitNum,
                offset: offsetNum,
                total: mockRecords.length, // with DB: use COUNT(*) query
            },
            _note: 'CDR database not yet connected — showing mock data. See src/routes/history.js to connect MariaDB.',
        });

        // ── REAL IMPLEMENTATION (uncomment when CDR DB is ready): ───────────────
        // const db = getDb();
        // const params = [startDate, endDate];
        // let whereExtra = '';
        // if (extension) { whereExtra += ' AND src = ?'; params.push(extension); }
        // if (phone) { whereExtra += ' AND dst LIKE ?'; params.push(`%${phone}%`); }
        // if (status) { whereExtra += ' AND disposition = ?'; params.push(status.toUpperCase()); }
        //
        // const [rows] = await db.query(
        //   `SELECT uniqueid, calldate, src, dst, duration, billsec, disposition, userfield
        //    FROM cdr
        //    WHERE calldate BETWEEN ? AND ?
        //    ${whereExtra}
        //    ORDER BY calldate DESC
        //    LIMIT ? OFFSET ?`,
        //   [...params, limitNum, offsetNum]
        // );
        //
        // const [countResult] = await db.query(
        //   `SELECT COUNT(*) AS total FROM cdr WHERE calldate BETWEEN ? AND ? ${whereExtra}`,
        //   params
        // );
        //
        // return res.json({
        //   status: 1,
        //   data: rows.map(_mapCdrRow),
        //   pagination: { limit: limitNum, offset: offsetNum, total: countResult[0].total },
        // });

    } catch (err) {
        logger.error('Failed to fetch call history', { error: err.message });
        return res.status(500).json({
            status: 0,
            comment: 'Failed to fetch call history: ' + err.message,
        });
    }
});

// ─── Helper: map CDR row → OnlinePBX history record format ───────────────────
// function _mapCdrRow(row) {
//   return {
//     id:           row.uniqueid,
//     call_id:      row.uniqueid,
//     start:        row.calldate,
//     end:          null, // calculated from calldate + duration
//     duration:     row.duration,
//     billsec:      row.billsec,
//     from:         row.src,
//     to:           row.dst,
//     status:       _mapDisposition(row.disposition),
//     recording:    row.userfield || null, // set by recording service
//     direction:    /^\d{2,4}$/.test(row.src) ? 'outbound' : 'inbound',
//   };
// }
//
// function _mapDisposition(disposition) {
//   const map = {
//     'ANSWERED':  'answered',
//     'NO ANSWER': 'missed',
//     'BUSY':      'busy',
//     'FAILED':    'failed',
//   };
//   return map[disposition?.toUpperCase()] || 'unknown';
// }

// ─── Mock data generator (dev/staging use only) ───────────────────────────────
function _generateMockHistory({ limitNum }) {
    const statuses = ['answered', 'missed', 'busy', 'failed'];
    const directions = ['outbound', 'inbound'];
    const extensions = ['101', '102', '103'];

    return Array.from({ length: Math.min(limitNum, 5) }, (_, i) => ({
        id: `mock-call-${i + 1}`,
        call_id: `mock-call-${i + 1}`,
        start: new Date(Date.now() - i * 3600000).toISOString(),
        end: new Date(Date.now() - i * 3600000 + 120000).toISOString(),
        duration: 120 - i * 15,
        billsec: 100 - i * 12,
        from: extensions[i % extensions.length],
        to: `+7900${1234567 + i}`,
        status: statuses[i % statuses.length],
        direction: directions[i % directions.length],
        recording: null,
    }));
}

module.exports = router;
