// test.js — Quick API test suite for the Telephony Server
// Run: node test.js
// The server must be running on http://localhost:3000 first (npm run dev)

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'test-api-key-12345';

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: 'localhost',
            port: 3000,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

// ─── Test runner ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function check(name, condition, actual) {
    if (condition) {
        console.log(`  ✅ ${name}`);
        passed++;
    } else {
        console.log(`  ❌ ${name}`);
        console.log(`     Got: ${JSON.stringify(actual)}`);
        failed++;
    }
}

async function runTests() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  SatuBooster Telephony Server — API Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // ── Test 1: Health check (no auth required) ─────────────────────────────────
    console.log('📋 Test 1: GET /health (public endpoint)');
    try {
        const r = await request('GET', '/health');
        check('Status 200', r.status === 200, r.status);
        check('status: ok', r.body.status === 'ok', r.body.status);
        check('Has version', !!r.body.version, r.body.version);
        check('Has asterisk_connected field', 'asterisk_connected' in r.body, r.body);
        console.log(`  ℹ️  asterisk_connected: ${r.body.asterisk_connected} (false = no FreePBX locally, expected)\n`);
    } catch (e) {
        check('Server reachable', false, e.message);
        console.log('\n🛑 Server is not running! Start it with: npm run dev\n');
        process.exit(1);
    }

    // ── Test 2: Root route ──────────────────────────────────────────────────────
    console.log('📋 Test 2: GET / (root info)');
    const r2 = await request('GET', '/');
    check('Status 200', r2.status === 200, r2.status);
    check('Has service name', r2.body.service?.includes('SatuBooster'), r2.body.service);
    console.log('');

    // ── Test 3: Auth — no API key ───────────────────────────────────────────────
    console.log('📋 Test 3: POST /api/auth — missing API key (should fail 401)');
    const r3 = await request('POST', '/api/auth');
    check('Status 401', r3.status === 401, r3.status);
    check('success: false', r3.body.success === false, r3.body);
    console.log('');

    // ── Test 4: Auth — wrong API key ────────────────────────────────────────────
    console.log('📋 Test 4: POST /api/auth — wrong API key (should fail 401)');
    const r4 = await request('POST', '/api/auth', null, { 'x-api-key': 'WRONG-KEY' });
    check('Status 401', r4.status === 401, r4.status);
    check('success: false', r4.body.success === false, r4.body);
    console.log('');

    // ── Test 5: Auth — correct API key ──────────────────────────────────────────
    console.log('📋 Test 5: POST /api/auth — correct API key (should succeed)');
    const r5 = await request('POST', '/api/auth', null, { 'x-api-key': API_KEY });
    check('Status 200', r5.status === 200, r5.status);
    check('success: true', r5.body.success === true, r5.body);
    check('server: SatuBooster PBX', r5.body.server === 'SatuBooster PBX', r5.body.server);
    console.log('');

    // ── Test 6: Auth GET (for CRM Settings "Test Connection" button) ─────────────
    console.log('📋 Test 6: GET /api/auth — test connection button (GET method)');
    const r6 = await request('GET', '/api/auth', null, { 'x-api-key': API_KEY });
    check('Status 200', r6.status === 200, r6.status);
    check('success: true', r6.body.success === true, r6.body);
    console.log('');

    // ── Test 7: Call/now — missing fields ───────────────────────────────────────
    console.log('📋 Test 7: POST /api/call/now — missing from/to (should fail 400)');
    const r7 = await request('POST', '/api/call/now', {}, { 'x-api-key': API_KEY });
    check('Status 400', r7.status === 400, r7.status);
    check('status: 0 (OnlinePBX format)', r7.body.status === 0, r7.body);
    console.log('');

    // ── Test 8: Call/now — invalid extension ─────────────────────────────────────
    console.log('📋 Test 8: POST /api/call/now — invalid extension (should fail 400)');
    const r8 = await request(
        'POST',
        '/api/call/now',
        { from: 'abc', to: '+79001234567' },
        { 'x-api-key': API_KEY }
    );
    check('Status 400', r8.status === 400, r8.status);
    check('status: 0', r8.body.status === 0, r8.body);
    console.log('');

    // ── Test 9: Call/now — valid params but no Asterisk (expected 500 since no AMI)
    console.log('📋 Test 9: POST /api/call/now — valid params (fails 500 — no AMI)');
    const r9 = await request(
        'POST',
        '/api/call/now',
        { from: '101', to: '+79001234567' },
        { 'x-api-key': API_KEY }
    );
    check('status: 0 (OnlinePBX format)', r9.body.status === 0, r9.body);
    check('Has comment field', !!r9.body.comment, r9.body.comment);
    console.log(`  ℹ️  Expected error: "${r9.body.comment}" (no Asterisk = expected)\n`);

    // ── Test 10: Active calls ────────────────────────────────────────────────────
    console.log('📋 Test 10: GET /api/call/active — list active calls');
    const r10 = await request('GET', '/api/call/active', null, { 'x-api-key': API_KEY });
    check('Status 200', r10.status === 200, r10.status);
    check('success: true', r10.body.success === true, r10.body);
    check('Has count field', typeof r10.body.count === 'number', r10.body.count);
    check('Has data array', Array.isArray(r10.body.data), r10.body.data);
    console.log('');

    // ── Test 11: Call history ────────────────────────────────────────────────────
    console.log('📋 Test 11: GET /api/history — call history (mock data)');
    const r11 = await request('GET', '/api/history', null, { 'x-api-key': API_KEY });
    check('Status 200', r11.status === 200, r11.status);
    check('status: 1 (OnlinePBX format)', r11.body.status === 1, r11.body.status);
    check('Has data array', Array.isArray(r11.body.data), r11.body.data);
    check('Has pagination', !!r11.body.pagination, r11.body.pagination);
    console.log('');

    // ── Test 12: History filtering ───────────────────────────────────────────────
    console.log('📋 Test 12: GET /api/history?limit=2 — history with pagination');
    const r12 = await request('GET', '/api/history?limit=2', null, { 'x-api-key': API_KEY });
    check('Status 200', r12.status === 200, r12.status);
    check('Respects limit=2', r12.body.data?.length <= 2, r12.body.data?.length);
    console.log('');

    // ── Test 13: Webhook endpoint ────────────────────────────────────────────────
    console.log('📋 Test 13: POST /api/webhook — receive call event');
    const r13 = await request(
        'POST',
        '/api/webhook',
        {
            event: 'call_end',
            call_id: 'test-call-123',
            caller: '101',
            callee: '+79001234567',
            direction: 'outbound',
            duration: 65,
            status: 'answered',
            timestamp: new Date().toISOString(),
        },
        { 'x-api-key': API_KEY }
    );
    check('Status 200', r13.status === 200, r13.status);
    check('success: true', r13.body.success === true, r13.body);
    check('event confirmed', r13.body.event === 'call_end', r13.body.event);
    check('call_id echoed', r13.body.call_id === 'test-call-123', r13.body.call_id);
    console.log('');

    // ── Test 14: Webhook — invalid event ────────────────────────────────────────
    console.log('📋 Test 14: POST /api/webhook — invalid event type (400)');
    const r14 = await request(
        'POST',
        '/api/webhook',
        { event: 'invalid_event' },
        { 'x-api-key': API_KEY }
    );
    check('Status 400', r14.status === 400, r14.status);
    check('success: false', r14.body.success === false, r14.body);
    console.log('');

    // ── Test 15: 404 for unknown route ──────────────────────────────────────────
    console.log('📋 Test 15: GET /api/nonexistent — 404 handler');
    const r15 = await request('GET', '/api/nonexistent', null, { 'x-api-key': API_KEY });
    check('Status 404', r15.status === 404, r15.status);
    check('success: false', r15.body.success === false, r15.body);
    console.log('');

    // ── Summary ──────────────────────────────────────────────────────────────────
    const total = passed + failed;
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Results: ${passed}/${total} passed`);
    if (failed === 0) {
        console.log('  🎉 All tests passed!');
    } else {
        console.log(`  ⚠️  ${failed} tests failed`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
    console.error('Test runner error:', err.message);
    process.exit(1);
});
