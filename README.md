# 📞 SatuBooster Telephony Server

> Self-hosted REST API bridge that replaces the OnlinePBX dependency in the SatuBooster CRM.  
> Connects to **FreePBX / Asterisk** and exposes a clean API for the CRM to make calls, view history, and receive webhooks.

---

## 🏗 Architecture

```
CRM Frontend (React)
      │
      ▼
Supabase Edge Function (telephony-callback)
      │
      ▼
┌─────────────────────────────────────┐
│  THIS SERVER  (Node.js + Express)   │  ← You are here
│  - REST API compatible with CRM     │
│  - Talks to Asterisk via AMI        │
│  - Forwards events to Supabase      │
│  - Uploads recordings to Storage    │
└─────────────────────────────────────┘
      │
      ▼
FreePBX / Asterisk (Self-Hosted)
      │
      ▼
SIP Trunk (Telnyx / VoIP.ms) → Real Phone Network
```

---

## 📋 API Endpoints

All protected endpoints require the `x-api-key` header.

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Server info |
| `GET` | `/health` | Health check (for monitoring) |

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth` | Validate API key |
| `GET` | `/api/auth` | Test connection (CRM Settings button) |

### Calls

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/call/now` | Initiate outbound call |
| `GET` | `/api/call/active` | List currently active calls |
| `POST` | `/api/call/hangup` | Hang up an active call |

### History

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/history` | Get call history (CDR) |

**Query Parameters:**
- `start` — Start date (ISO 8601), default: 7 days ago
- `end` — End date (ISO 8601), default: now
- `limit` — Max records (1-500), default: 50
- `offset` — Pagination offset, default: 0
- `direction` — Filter: `inbound`, `outbound`, or `all`
- `extension` — Filter by extension number

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/webhook` | Receive call events from Asterisk |
| `POST` | `/api/webhook/telnyx` | Receive Telnyx SIP events (no auth) |

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- **Node.js 18+**
- **npm**

### Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd telephoney-server

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env
# Edit .env with your values (the defaults work for local testing)

# 4. Start the dev server
npm run dev

# 5. Run tests (in another terminal)
node test.js
```

The server starts on `http://localhost:3000` even without Asterisk — all API endpoints work with mock/graceful fallbacks.

---

## 🐳 Docker Deployment (Production)

### Option A: API Only (Asterisk already installed separately)

```bash
# Build the image
docker build -t satubooster-telephony .

# Run with your .env file
docker run -d \
  --name telephony-api \
  --env-file .env \
  -p 3000:3000 \
  --restart unless-stopped \
  satubooster-telephony
```

### Option B: Full Stack (FreePBX + API together)

```bash
# 1. Create .env from template
cp .env.example .env
# Edit .env with your real values

# 2. Start everything
docker-compose up -d

# 3. View logs
docker-compose logs -f api       # API logs
docker-compose logs -f freepbx   # FreePBX logs

# 4. Access
# - REST API:       http://your-server:3000
# - FreePBX Admin:  http://your-server:8080
```

### Option C: PM2 (No Docker)

```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.js --env production

# Enable auto-start on reboot
pm2 startup
pm2 save

# Monitor
pm2 monit
```

---

## 📁 Project Structure

```
telephoney-server/
├── src/
│   ├── index.js              # Express server entry point
│   ├── middleware/
│   │   └── auth.js           # API key validation middleware
│   ├── routes/
│   │   ├── auth.js           # POST/GET /api/auth
│   │   ├── calls.js          # POST /api/call/now, GET /api/call/active
│   │   ├── history.js        # GET /api/history (CDR query)
│   │   └── webhooks.js       # POST /api/webhook (from Asterisk/Telnyx)
│   ├── services/
│   │   ├── asterisk.js       # AMI connection + call origination
│   │   ├── callManager.js    # Call state tracking + Supabase forwarding
│   │   └── recordings.js     # Recording upload to Supabase Storage
│   └── utils/
│       └── logger.js         # Winston logger
├── .env.example              # Environment variable template
├── Dockerfile                # Multi-stage production build
├── docker-compose.yml        # Full stack (FreePBX + API)
├── ecosystem.config.js       # PM2 configuration
├── package.json
├── plan.md                   # Full migration plan
├── test.js                   # API test suite (39 tests)
└── README.md                 # ← You are reading this
```

---

## 🔑 API Request Examples

### Authenticate

```bash
curl -X POST http://localhost:3000/api/auth \
  -H "x-api-key: your-api-key"
```

**Response:**
```json
{
  "success": true,
  "server": "SatuBooster PBX",
  "version": "1.0.0",
  "asterisk_connected": true
}
```

### Make an Outbound Call

```bash
curl -X POST http://localhost:3000/api/call/now \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"from": "101", "to": "+79001234567"}'
```

**Response:**
```json
{
  "status": 1,
  "data": {
    "call_id": "1708693822.12",
    "action_id": "uuid-string"
  }
}
```

### Get Call History

```bash
curl "http://localhost:3000/api/history?limit=10&direction=outbound" \
  -H "x-api-key: your-api-key"
```

**Response:**
```json
{
  "status": 1,
  "data": [
    {
      "id": "abc123",
      "caller": "101",
      "callee": "+79001234567",
      "direction": "outbound",
      "status": "answered",
      "duration": 65,
      "started_at": "2026-02-25T10:00:00Z",
      "recording_url": "https://..."
    }
  ],
  "pagination": {
    "total": 42,
    "limit": 10,
    "offset": 0
  }
}
```

### Receive Webhook Event

```bash
curl -X POST http://localhost:3000/api/webhook \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "call_end",
    "call_id": "1708693822.12",
    "caller": "101",
    "callee": "+79001234567",
    "direction": "outbound",
    "duration": 65,
    "status": "answered"
  }'
```

---

## 🧪 Testing

```bash
# Start the server first
npm run dev

# Run the full test suite (39 tests)
node test.js
```

Tests cover: health check, auth (valid/invalid/missing key), call origination (validation + AMI error), active calls, history with pagination, webhooks (valid/invalid), and 404 handling.

---

## 🔒 Security Features

- **API Key Authentication** — All `/api/*` routes require `x-api-key` header
- **Rate Limiting** — 200 requests per 15 minutes per IP
- **Helmet** — Security headers (XSS, clickjacking, etc.)
- **CORS** — Configurable allowed origins
- **Non-root Docker** — Container runs as unprivileged user
- **Graceful Shutdown** — Clean disconnection on SIGTERM/SIGINT

---

## 📊 Monitoring

- **Health endpoint:** `GET /health` — returns server status, Asterisk connection, and uptime
- **PM2:** `pm2 monit` for CPU/memory monitoring
- **UptimeRobot (free):** Ping `/health` every 5 minutes for uptime alerts
- **Docker health check:** Built into the Dockerfile

---

## 📝 OnlinePBX Compatibility

This API is designed to be a **drop-in replacement** for OnlinePBX's API. Response formats match the OnlinePBX conventions:

| OnlinePBX | Our API | Status |
|-----------|---------|--------|
| `POST /call/now.json` | `POST /api/call/now` | ✅ Compatible |
| `GET /history/search.json` | `GET /api/history` | ✅ Compatible |
| `POST /auth.json` | `POST /api/auth` | ✅ Compatible |
| `GET /user/get.json` | `GET /api/user` | ✅ Compatible |
| Webhook events | `POST /api/webhook` | ✅ Compatible |

---

## 📄 License

MIT — SatuBooster
