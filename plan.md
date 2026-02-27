# 📞 SatuBooster CRM — Self-Hosted Telephony Service Plan
## Replacing OnlinePBX with FreePBX (Open Source PBX)

**Created:** 2026-02-22  
**Goal:** Build and integrate our own telephony service to replace the OnlinePBX dependency  
**Estimated Duration:** 6–8 weeks (1 full-time developer)  
**Total Monthly Cost After Setup:** ~$25–70/month (server + SIP trunk only)

---

## 📋 Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Technology Stack](#2-technology-stack)
3. [Phase 1 — Server Setup (Week 1)](#phase-1--server-setup-week-1)
4. [Phase 2 — FreePBX Installation (Week 1–2)](#phase-2--freepbx-installation-week-12)
5. [Phase 3 — SIP Trunk Configuration (Week 2)](#phase-3--sip-trunk-configuration-week-2)
6. [Phase 4 — REST API Bridge (Week 3–4)](#phase-4--rest-api-bridge-week-34)
7. [Phase 5 — CRM Integration (Week 4–5)](#phase-5--crm-integration-week-45)
8. [Phase 6 — Call Recordings & Webhooks (Week 5–6)](#phase-6--call-recordings--webhooks-week-56)
9. [Phase 7 — Testing & Security (Week 7)](#phase-7--testing--security-week-7)
10. [Phase 8 — Production Go-Live (Week 8)](#phase-8--production-go-live-week-8)
11. [Cost Breakdown](#cost-breakdown)
12. [Risk & Challenges](#risk--challenges)
13. [Rollback Plan](#rollback-plan)
14. [Files to Change in CRM](#files-to-change-in-crm)

---

## 1. Overview & Architecture

### Current Architecture (OnlinePBX)
```
CRM Frontend (React)
      │
      ▼
Supabase Edge Function (telephony-callback)
      │
      ▼
OnlinePBX API (api2.onlinepbx.ru)  ← PAID, 3rd party
      │
      ▼
Real Phone Network
      │
      ▼ (Webhook)
Supabase Edge Function (telephony-webhook)
      │
      ▼
Supabase DB (telephony_calls)
```

### New Architecture (Self-Hosted FreePBX)
```
CRM Frontend (React)
      │
      ▼
Supabase Edge Function (telephony-callback)  ← SAME FILE, small changes
      │
      ▼
Our REST API Layer (Node.js)  ← NEW: Built by us
      │
      ▼
FreePBX / Asterisk (Self-Hosted VPS)  ← FREE, open source
      │
      ▼
Telnyx / VoIP.ms SIP Trunk (cheap phone numbers)
      │
      ▼
Real Phone Network
      │
      ▼ (Webhook)
Our REST API → Supabase Edge Function (telephony-webhook)
      │
      ▼
Supabase DB (telephony_calls)  ← SAME, no changes needed
```

---

## 2. Technology Stack

| Layer | Technology | License | Cost |
|-------|-----------|---------|------|
| PBX Engine | **FreePBX + Asterisk** | GPL (Free) | $0 |
| Server OS | **Ubuntu 22.04 LTS** | Free | $0 |
| VPS Hosting | **Hetzner CX21 or DigitalOcean** | Paid | ~$20/month |
| SIP Trunk | **Telnyx** (or VoIP.ms) | Pay-per-use | ~$5–20/month |
| REST API | **Node.js + Express** | Free | $0 |
| Call Recordings | **Supabase Storage** (or local disk) | Free tier | $0–5/month |
| Monitoring | **PM2 + UptimeRobot** | Free | $0 |
| SSL | **Let's Encrypt (Certbot)** | Free | $0 |
| Reverse Proxy | **Nginx** | Free | $0 |

---

## Phase 1 — Server Setup (Week 1)

### 🎯 Goal: Get a VPS server ready

### Tasks:

#### 1.1 Provision a VPS Server
- [ ] Create account on **Hetzner** (cheapest) or **DigitalOcean**
- [ ] Choose Server Specs:
  - **OS:** Ubuntu 22.04 LTS
  - **RAM:** Minimum 4GB (8GB recommended for production)
  - **CPU:** 2 vCPU minimum
  - **Disk:** 50GB SSD (for call recordings)
  - **Cost:** ~$15–20/month on Hetzner

```bash
# Hetzner recommended plan: CX21
# CPU: 3 vCPU | RAM: 4GB | Disk: 80GB | Cost: €5.83/month
```

#### 1.2 Initial Server Configuration
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y curl wget git vim net-tools htop fail2ban ufw

# Set timezone
sudo timedatectl set-timezone Asia/Kolkata

# Create non-root user
adduser pbxadmin
usermod -aG sudo pbxadmin
```

#### 1.3 Firewall Setup (UFW)
```bash
# Allow SSH
sudo ufw allow ssh

# Allow SIP (VoIP calls)
sudo ufw allow 5060/tcp   # SIP TCP
sudo ufw allow 5060/udp   # SIP UDP
sudo ufw allow 5061/tcp   # SIP TLS

# Allow RTP (Audio streaming - real call audio)
sudo ufw allow 10000:20000/udp  # RTP audio range

# Allow HTTP/HTTPS (for our REST API)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow FreePBX Admin (restrict to your IP later!)
sudo ufw allow 8080/tcp

# Enable firewall
sudo ufw enable
```

#### 1.4 Point a Domain/Subdomain to This Server
```
Example: pbx.yourdomain.com → VPS IP address
This is needed for:
- SSL certificate
- Webhook callbacks from Asterisk
- CRM to call our REST API
```

**Estimated Time:** 1–2 days  
**Skills Needed:** Basic Linux / VPS knowledge

---

## Phase 2 — FreePBX Installation (Week 1–2)

### 🎯 Goal: Install and configure FreePBX with Asterisk

### Option A: Docker Installation (Fastest - Recommended for testing)

```bash
# Install Docker
curl -fsSL https://get.docker.com | bash

# Pull and run FreePBX in Docker
docker run -d \
  --name freepbx \
  --restart unless-stopped \
  -p 80:80 \
  -p 5060:5060/udp \
  -p 5060:5060/tcp \
  -p 10000-10100:10000-10100/udp \
  -v /var/lib/freepbx:/var/lib/asterisk \
  tiredofit/freepbx

# Admin UI will be at: http://your-server-ip/
```

### Option B: Native Installation (Recommended for Production)

```bash
# Download FreePBX Distro ISO or use this script for Ubuntu:
wget https://github.com/FreePBX/sng_freepbx_debian_install/raw/master/sng_freepbx_debian_install.sh
sudo bash sng_freepbx_debian_install.sh

# This installs:
# - Asterisk 20 (PBX engine)
# - FreePBX 16 (Web UI)
# - MariaDB (database)
# - Apache (web server)
# Takes ~30-45 minutes
```

### Tasks:

#### 2.1 Install FreePBX
- [ ] Run installation script
- [ ] Wait for completion (~30-45 min)
- [ ] Access FreePBX Admin UI at `http://your-server-ip`
- [ ] Complete initial setup wizard

#### 2.2 FreePBX Initial Configuration
- [ ] Set admin username and password
- [ ] Set system email
- [ ] Configure company name: **SatuBooster PBX**

#### 2.3 Create Extensions (Internal Numbers for Managers)
```
Go to: Applications → Extensions → Add Extension
Type: PJSIP (recommended)

Extension: 101  → Manager 1
Extension: 102  → Manager 2
Extension: 103  → Manager 3
...
```

#### 2.4 Enable Asterisk REST API (ARI)
```bash
# Edit Asterisk config to enable REST API
sudo nano /etc/asterisk/ari.conf

[general]
enabled = yes
pretty = yes

[satubooster_api]
type = user
read_only = no
password = YOUR_SECURE_API_PASSWORD
```

#### 2.5 Enable AMI (Asterisk Manager Interface)
```bash
sudo nano /etc/asterisk/manager.conf

[general]
enabled = yes
port = 5038
bindaddr = 127.0.0.1

[crm_user]
secret = YOUR_AMI_SECRET
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.0
read = all
write = all
```

**Estimated Time:** 2–3 days  
**Skills Needed:** Linux, basic understanding of PBX

---

## Phase 3 — SIP Trunk Configuration (Week 2)

### 🎯 Goal: Connect FreePBX to real phone network (get phone numbers)

### What is a SIP Trunk?
A SIP Trunk is the connection between your PBX and the real telephone network. You pay for minutes used, not a monthly subscription.

### Recommended Free / Cheap SIP Trunk Providers:

| Provider | Free Credits | Per-Minute Cost | Phone Number Cost |
|---------|-------------|----------------|-----------------|
| **Telnyx** | $10 free | ~$0.005/min | ~$1/month |
| **Twilio** | $15 free | ~$0.013/min | $1/month |
| **VoIP.ms** | None | ~$0.009/min | $0.85/month |
| **Vonage** | $10 free | ~$0.01/min | $1/month |

### Tasks:

#### 3.1 Sign Up for Telnyx (Recommended)
- [ ] Go to [telnyx.com](https://telnyx.com) and create account
- [ ] Verify identity (required for phone numbers)
- [ ] Add $10 credit (they match with free $10)
- [ ] Get a phone number (~$1/month)
- [ ] Get SIP credentials (username + password)

#### 3.2 Configure SIP Trunk in FreePBX
```
Go to: Connectivity → Trunks → Add Trunk → SIP (chan_pjsip) Trunk

General Settings:
  Trunk Name: Telnyx-Trunk

pjSIP Settings:
  Username: [Your Telnyx SIP username]
  Secret: [Your Telnyx SIP password]
  SIP Server: sip.telnyx.com
  SIP Server Port: 5060
```

#### 3.3 Create Inbound Route
```
Go to: Connectivity → Inbound Routes

DID Number: [Your Telnyx phone number]
Destination: Ring Group or Extension
```

#### 3.4 Create Outbound Route
```
Go to: Connectivity → Outbound Routes

Route Name: Outbound-Telnyx
Trunk Sequence: Telnyx-Trunk
Dial Patterns: NXXNXXXXXX (standard 10-digit)
```

#### 3.5 Test Calls
- [ ] Make a test outbound call
- [ ] Receive a test inbound call
- [ ] Verify audio quality (both ways)

**Estimated Time:** 2–3 days  
**Skills Needed:** FreePBX UI navigation

---

## Phase 4 — REST API Bridge (Week 3–4)

### 🎯 Goal: Build a Node.js REST API that our CRM will call (like OnlinePBX's API)

This is the most **important custom code** we write. It replaces `api2.onlinepbx.ru`.

### API Endpoints to Build:

| Method | Endpoint | Description | Replaces OnlinePBX |
|--------|----------|-------------|-------------------|
| `POST` | `/api/auth` | Validate API key | `/auth.json` |
| `POST` | `/api/call/now` | Make outbound call | `/call/now.json` |
| `GET`  | `/api/history` | Get call history | `/history/search.json` |
| `GET`  | `/api/user` | Test connection | `/user/get.json` |
| `POST` | `/api/webhook` | Receive call events from Asterisk | Internal |

### Project Structure:
```
freepbx-api/
├── src/
│   ├── index.js              # Express server entry point
│   ├── routes/
│   │   ├── auth.js           # API key validation
│   │   ├── calls.js          # Make calls, get history
│   │   └── webhooks.js       # Receive events from Asterisk
│   ├── services/
│   │   ├── asterisk.js       # AMI/ARI connection to Asterisk
│   │   ├── callManager.js    # Originate calls, track status
│   │   └── recordings.js     # Handle call recordings
│   ├── middleware/
│   │   └── auth.js           # API key authentication
│   └── utils/
│       └── logger.js         # Logging
├── .env                      # Config (not committed to git)
├── package.json
└── ecosystem.config.js       # PM2 process manager config
```

### Key Code Examples:

#### `src/index.js` — Main Server
```javascript
const express = require('express');
const app = express();
app.use(express.json());

app.use('/api/auth',    require('./routes/auth'));
app.use('/api/call',    require('./routes/calls'));
app.use('/api/history', require('./routes/history'));
app.use('/api/webhook', require('./routes/webhooks'));

app.listen(3000, () => console.log('PBX API running on port 3000'));
```

#### `src/services/asterisk.js` — Talk to Asterisk via AMI
```javascript
const AmiClient = require('asterisk-ami-client');

const client = new AmiClient();

async function originateCall(fromExtension, toPhone) {
  await client.connect('YOUR_AMI_SECRET', 'crm_user', {
    host: '127.0.0.1',
    port: 5038
  });
  
  // This is the equivalent of OnlinePBX's /call/now.json
  return await client.action({
    Action: 'Originate',
    Channel: `PJSIP/${fromExtension}`,    // Manager's extension
    Context: 'from-internal',
    Exten: toPhone,                        // Customer's number
    Priority: 1,
    CallerID: `CRM Call <${fromExtension}>`,
    Timeout: 30000,
    Async: 'yes'
  });
}

module.exports = { originateCall };
```

#### `src/routes/calls.js` — Make a Call
```javascript
const router = require('express').Router();
const { originateCall } = require('../services/asterisk');

// POST /api/call/now
// Same purpose as OnlinePBX's /call/now.json
router.post('/now', async (req, res) => {
  const { from, to } = req.body;   // from = extension, to = customer phone
  
  try {
    const result = await originateCall(from, to);
    res.json({ status: 1, data: { call_id: result.ActionID } });
  } catch (err) {
    res.json({ status: 0, comment: err.message });
  }
});

module.exports = router;
```

### Tasks:

#### 4.1 Initialize Node.js Project
```bash
mkdir freepbx-api && cd freepbx-api
npm init -y
npm install express asterisk-ami-client dotenv winston cors helmet
npm install -D nodemon
```

#### 4.2 Build Auth Middleware
- [ ] API key stored in `.env`
- [ ] Every request must include `x-api-key` header
- [ ] Return 401 if invalid

#### 4.3 Build `POST /api/call/now` Route
- [ ] Accept `from` (extension) and `to` (phone number)
- [ ] Connect to Asterisk AMI
- [ ] Originate call
- [ ] Return call_id
- [ ] Return same format as OnlinePBX (for minimal CRM changes)

#### 4.4 Build `GET /api/history` Route
- [ ] Query Asterisk CDR (Call Detail Records) database
- [ ] Return call history in same format as OnlinePBX

#### 4.5 Build `POST /api/webhook` Route
- [ ] Receive call events from Asterisk
- [ ] Forward to Supabase `telephony-webhook` function
- [ ] Map Asterisk event names to OnlinePBX event format

#### 4.6 Deploy API to Server with PM2
```bash
npm install -g pm2

# Start API
pm2 start src/index.js --name freepbx-api

# Auto-start on reboot
pm2 startup
pm2 save
```

**Estimated Time:** 1–2 weeks  
**Skills Needed:** Node.js, REST APIs, Asterisk AMI basics

---

## Phase 5 — CRM Integration (Week 4–5)

### 🎯 Goal: Update SatuBooster CRM to call our API instead of OnlinePBX

### Files to Modify in the CRM:

#### 5.1 Update `telephony-callback` Supabase Edge Function

**File:** `supabase/functions/telephony-callback/index.ts`

```typescript
// REMOVE THIS:
const ONLINEPBX_HOST = 'api2.onlinepbx.ru';

// ADD THIS:
const OUR_PBX_HOST = Deno.env.get('FREEPBX_API_URL') || 'https://pbx.yourdomain.com';
const OUR_PBX_API_KEY = Deno.env.get('FREEPBX_API_KEY') || '';

// REPLACE onlinePbxAuth() function with:
async function ourPbxAuth(apiKey: string): Promise<string> {
  // Our API just validates the API key — no session needed
  const response = await fetch(`${OUR_PBX_HOST}/api/auth`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  });
  const data = await response.json();
  if (!data.success) throw new Error('Auth failed');
  return apiKey; // reuse same key
}

// REPLACE onlinePbxRequest() with:
async function ourPbxRequest(path: string, body: object, apiKey: string) {
  const response = await fetch(`${OUR_PBX_HOST}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  return await response.json();
}

// REPLACE call API:
// FROM: onlinePbxRequest(domain, '/call/now.json', { from, to }, apiKey)
// TO:   ourPbxRequest('/api/call/now', { from: internalNumber, to: cleanPhone }, apiKey)
```

#### 5.2 Update Environment Variables in Supabase
```bash
# In Supabase Dashboard → Edge Functions → Environment Variables:
FREEPBX_API_URL = https://pbx.yourdomain.com
FREEPBX_API_KEY = your-secure-api-key-here

# Remove/keep but unused:
# ONLINEPBX credentials (can be removed later)
```

#### 5.3 Update `telephony_settings` Table (Optional)
```sql
-- The table currently stores: domain, api_key, internal_number, enabled
-- These still work perfectly for our new system:
-- domain → base URL of our FreePBX API
-- api_key → our API key
-- internal_number → manager's extension (same concept)
-- No schema change needed!
```

#### 5.4 Update Settings UI (TelephonySettings.tsx)
```tsx
// Change UI label from "OnlinePBX Domain" to "PBX Server URL"
// Change placeholder from "yourcompany.onlinepbx.ru"
//                      to "pbx.yourdomain.com"
// Everything else stays the same!
```

#### 5.5 Test End-to-End Flow
- [ ] Enter our PBX server URL in Settings
- [ ] Enter our API key in Settings
- [ ] Enter manager's extension number
- [ ] Click "Test Connection" → should get success
- [ ] Make a test call from the CRM UI

**Estimated Time:** 3–5 days  
**Skills Needed:** TypeScript, Supabase Edge Functions

---

## Phase 6 — Call Recordings & Webhooks (Week 5–6)

### 🎯 Goal: Recordings stored & call status updates working

### 6.1 Call Recording Setup in FreePBX
```
Go to: Admin → Advanced Settings

Find: Recording Options
- Enable recording: Yes
- Recording format: wav → mp3 (smaller files)
- Recording path: /var/spool/asterisk/monitor/

# After calls, recordings saved at:
/var/spool/asterisk/monitor/YYYY/MM/DD/filename.mp3
```

### 6.2 Upload Recordings to Supabase Storage
```javascript
// In our freepbx-api webhook handler, after call ends:
async function uploadRecording(localPath, callId) {
  const fileContent = fs.readFileSync(localPath);
  
  const { data, error } = await supabase.storage
    .from('call-recordings')
    .upload(`${callId}.mp3`, fileContent, {
      contentType: 'audio/mpeg',
      upsert: true
    });

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('call-recordings')
    .getPublicUrl(`${callId}.mp3`);

  // Update telephony_calls record with recording URL
  await supabase
    .from('telephony_calls')
    .update({ recording_url: publicUrl })
    .eq('id', callId);
}
```

### 6.3 Asterisk Webhook Events → Supabase
```javascript
// Asterisk emits AMI events. Our API listens and forwards:

const AMI_EVENTS = {
  'Newchannel':    'call_start',    // Call initiated
  'DialBegin':     'call_ringing',  // Phone ringing
  'Bridge':        'call_answered', // Call answered
  'Hangup':        'call_end',      // Call ended
};

amiClient.on('AMIEvent', async (event) => {
  const pbxEvent = AMI_EVENTS[event.Event];
  if (!pbxEvent) return;

  // Forward to Supabase webhook function (same as OnlinePBX webhooks!)
  await fetch(process.env.SUPABASE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: pbxEvent,
      call_id: event.Uniqueid,
      caller: event.CallerIDNum,
      callee: event.Exten,
      direction: 'outbound',
      // Map to same format as OnlinePBX webhooks
    })
  });
});
```

### 6.4 Tasks:
- [ ] Enable call recording in FreePBX
- [ ] Build recording upload service (Asterisk → Supabase Storage)
- [ ] Map Asterisk AMI events to OnlinePBX webhook format
- [ ] Test full call cycle: initiate → ring → answer → hang up → recording available
- [ ] Verify recording appears in CRM call history

**Estimated Time:** 1 week  
**Skills Needed:** Node.js, file handling, Supabase Storage

---

## Phase 7 — Testing & Security (Week 7)

### 🎯 Goal: Ensure everything is secure and reliable

### 7.1 Security Hardening
```bash
# 1. Install Fail2Ban (auto-blocks brute force attackers)
sudo apt install fail2ban
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local

# 2. Configure Fail2Ban for SIP attacks (very common!)
sudo nano /etc/fail2ban/jail.local

[asterisk]
enabled = true
filter = asterisk
action = iptables-allports[name=ASTERISK, protocol=all]
logpath = /var/log/asterisk/messages
maxretry = 5
bantime = 3600

# 3. SSL Certificate for our API (via Let's Encrypt)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d pbx.yourdomain.com

# 4. Nginx reverse proxy (routes HTTPS → our Node.js API)
sudo nano /etc/nginx/sites-available/freepbx-api

server {
    server_name pbx.yourdomain.com;
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 7.2 Rate Limiting
```javascript
// In our Node.js API:
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100                   // limit each IP to 100 requests per window
});

app.use('/api/', limiter);
```

### 7.3 Logging & Monitoring
```bash
# PM2 monitoring
pm2 monit

# Set up UptimeRobot (free) to ping our API every 5 minutes
# Alert via email if API goes down
# URL to monitor: https://pbx.yourdomain.com/api/health
```

### 7.4 Testing Checklist
- [ ] Outbound call from CRM → reaches customer phone ✅
- [ ] Inbound call → logged in CRM Telephony page ✅
- [ ] Missed call → status shows "missed" in CRM ✅
- [ ] Call recording → plays back in CRM ✅
- [ ] Call history → shows in CRM Telephony page ✅
- [ ] Manager extension → correct extension used per manager ✅
- [ ] Test Connection button in Settings → shows ✅
- [ ] Server stays up for 24 hours without restart ✅
- [ ] Load test: 10 simultaneous calls ✅

**Estimated Time:** 3–5 days  
**Skills Needed:** Linux security, testing

---

## Phase 8 — Production Go-Live (Week 8)

### 🎯 Goal: Switch from OnlinePBX to our own system

### 8.1 Pre-Launch Checklist
- [ ] All tests passing
- [ ] SSL certificate installed
- [ ] Backups configured
- [ ] Monitoring active (UptimeRobot)
- [ ] Rollback plan documented
- [ ] Team trained on new system

### 8.2 Migration Steps
```
Step 1: Keep OnlinePBX active during testing
Step 2: Run our system in parallel (shadow mode)
Step 3: Switch 1 manager to new system for 1 week
Step 4: If all good → switch all managers
Step 5: Disable OnlinePBX after 2 weeks (keep account for 1 more month as backup)
```

### 8.3 Update Supabase Environment Variables
```bash
# In Supabase Dashboard:
FREEPBX_API_URL = https://pbx.yourdomain.com   # Our server
FREEPBX_API_KEY = strong-random-key-here

# In CRM Settings (telephony_settings table):
domain = pbx.yourdomain.com
api_key = strong-random-key-here
internal_number = 101  # (remains same concept)
```

### 8.4 Post-Launch Monitoring (Week 8–9)
- [ ] Monitor error logs daily
- [ ] Check call quality feedback from managers
- [ ] Verify recordings uploading correctly
- [ ] Check Supabase storage usage
- [ ] Monitor server CPU/RAM usage

**Estimated Time:** 3–5 days

---

## Cost Breakdown

### One-Time Setup Costs
| Item | Cost |
|------|------|
| Developer time (if outsourced) | $0 (in-house) |
| Domain/Subdomain | Already have it |
| **Total One-Time** | **$0** |

### Monthly Recurring Costs
| Item | Estimated Cost |
|------|---------------|
| Hetzner VPS (CX21) | ~$6/month |
| Telnyx SIP Trunk (pay per call) | ~$5–20/month |
| Phone Number (1 DID) | ~$1/month |
| Supabase Storage (recordings) | ~$0–5/month |
| **Total Monthly** | **~$12–32/month** |

### Comparison with OnlinePBX
```
OnlinePBX:  [Their pricing] per month
Our System: $12–32/month
Savings:    Significant long-term savings
Break-even: After 2–3 months of use
```

---

## Risk & Challenges

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| VoIP spam/attacks on server | 🔴 High | High | Fail2Ban + strict firewall |
| Audio quality issues | 🟡 Medium | High | Proper codec config (G.711 ulaw) |
| Server downtime | 🟡 Medium | High | PM2 auto-restart + UptimeRobot alerts |
| SIP NAT traversal issues | 🔴 High | High | Configure STUN server in Asterisk |
| Call recording disk space | 🟢 Low | Medium | Auto-upload to cloud, delete local |
| Asterisk AMI connection drops | 🟡 Medium | Medium | Auto-reconnect logic in Node.js |
| Manager extension misconfiguration | 🟢 Low | Medium | Validation in Settings UI |

### Most Important: NAT Configuration
```bash
# If server is behind NAT (common with VPS), edit:
sudo nano /etc/asterisk/pjsip.conf

[transport-udp]
type = transport
protocol = udp
bind = 0.0.0.0
external_media_address = YOUR_PUBLIC_IP
external_signaling_address = YOUR_PUBLIC_IP
local_net = 192.168.0.0/16
local_net = 10.0.0.0/8
```

---

## Rollback Plan

If anything goes wrong, we can immediately switch back to OnlinePBX:

```bash
# Step 1: In Supabase Environment Variables:
# Change back FREEPBX_API_URL to use OnlinePBX format

# Step 2: In telephony-callback/index.ts:
# Uncomment OnlinePBX code, comment out our API code

# Step 3: In CRM Settings:
# Update domain back to OnlinePBX domain

# Total rollback time: ~15 minutes
```

> **⚠️ Keep OnlinePBX account active for at least 1 month after go-live as safety net.**

---

## Files to Change in CRM

| File | Change Type | Effort |
|------|------------|--------|
| `supabase/functions/telephony-callback/index.ts` | Replace API calls | 🟡 Medium (2–3 hours) |
| `src/components/settings/TelephonySettings.tsx` | Update UI labels | 🟢 Easy (30 min) |
| `src/pages/Telephony.tsx` | Update "OnlinePBX" text references | 🟢 Easy (15 min) |
| `supabase/functions/telephony-webhook/index.ts` | Minor format adjustments | 🟢 Easy (1 hour) |

**Total CRM Code Changes:** ~4–6 hours of development

---

## 📅 Full Timeline Summary

| Week | Phase | Deliverable |
|------|-------|------------|
| Week 1 | Server Setup + FreePBX Install | VPS running with FreePBX |
| Week 2 | SIP Trunk + Test Calls | Real calls working via FreePBX |
| Week 3 | REST API — Core | `/api/call/now` working |
| Week 4 | REST API — Complete | All endpoints working |
| Week 5 | CRM Integration | CRM calls our API instead of OnlinePBX |
| Week 6 | Recordings + Webhooks | Full call cycle working in CRM |
| Week 7 | Security + Testing | Production-ready, fully tested |
| Week 8 | Go Live | OnlinePBX replaced ✅ |

---

## ✅ Definition of Done

The project is complete when:

1. ✅ Manager opens CRM → clicks call button → customer's phone rings
2. ✅ Call is logged automatically in Supabase `telephony_calls`
3. ✅ After call ends → recording appears in CRM call history
4. ✅ Inbound calls are detected and logged automatically
5. ✅ All existing telephony features work identically to OnlinePBX
6. ✅ Zero dependency on OnlinePBX
7. ✅ Monthly cost is reduced significantly
8. ✅ System is monitored and auto-restarts on failure

---

*Plan created: 2026-02-22 | SatuBooster CRM Telephony Migration*
