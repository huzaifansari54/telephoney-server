# 📋 Request for Telephony Server Configuration & Credentials

Hi! Here is the list of required credentials and configuration settings needed to finalize the deployment of the **SatuBooster Telephony Server**. 

Please provide the following values or ensure they are configured in the server's `.env` file.

---

### 1. 🔑 API Authentication (Shared Secret)
This key is used by the CRM and Supabase to authenticate requests to the telephony server.
*   **API_KEY**: (Please generate a long random string, e.g., `openssl rand -hex 32`)

---

### 2. 📞 Asterisk AMI (Manager Interface)
Required for monitoring live call events (Internal communication).
*   **AMI_HOST**: (Default: `127.0.0.1`)
*   **AMI_PORT**: (Default: `5038`)
*   **AMI_USERNAME**: (Create a user in `/etc/asterisk/manager.conf`)
*   **AMI_SECRET**: (Password for the AMI user)

---

### 3. 🌐 Asterisk ARI (REST Interface)
Required for initiating outbound calls (Click-to-Call).
*   **ARI_HOST**: (Default: `http://127.0.0.1`)
*   **ARI_PORT**: (Default: `8088`)
*   **ARI_USERNAME**: (Create a user in `/etc/asterisk/ari.conf`)
*   **ARI_PASSWORD**: (Password for the ARI user)

---

### 4. 🔗 Supabase Integration
Required for uploading call recordings and sending webhooks to the CRM.
*   **SUPABASE_URL**: (`https://[your-project].supabase.co`)
*   **SUPABASE_SERVICE_KEY**: (From Supabase Dashboard → Settings → API → `service_role` key)
*   **SUPABASE_WEBHOOK_URL**: (`https://[your-project].supabase.co/functions/v1/telephony-webhook`)

---

### 5. 🌍 Environment & Networking
*   **CORS_ORIGINS**: (Comma-separated URLs of the CRM frontend, e.g., `https://crm.yourdomain.com`)
*   **ASTERISK_RECORDINGS_PATH**: Path where FreePBX saves call logs (Default: `/var/spool/asterisk/monitor`)
*   **FREEPBX_DB_PASSWORD**: (Database password if running via Docker/Compose)

---

### 🛡️ Firewall & Security Requirements
Please ensure the following ports are configured:
*   **Port 80/443 (Public)**: For the Telephony Server API (Should be secured with SSL/Certbot).
*   **Port 5038 & 8088 (Internal Only)**: Must be accessible by the Telephony Server but blocked from public access.

---

### 📁 Files for Reference
The template for these configurations is located in the repository at:
`[project-root]/.env.example`
