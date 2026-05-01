# 🚀 Next Steps: Telephony Integration & Deployment

This guide outlines the remaining tasks to successfully integrate the **SatuBooster Telephony Server** with your CRM and Supabase environment.

---

## 1. 📂 Server Environment Setup (`.env`)
Ensure the `.env` file on your VPS is fully configured to enable communication with Supabase.

| Variable | Description | Value Example |
| :--- | :--- | :--- |
| `SUPABASE_WEBHOOK_URL` | Endpoint for call events | `https://[your-project].supabase.co/functions/v1/telephony-webhook` |
| `SUPABASE_SERVICE_KEY` | Supabase Service Role Key | `eyJhbGciOiJIUzI1Ni...` |
| `API_KEY` | Shared secret with CRM | `[generate-random-long-string]` |
| `AMI_HOST` | Asterisk Manager IP | `127.0.0.1` (usually) |
| `CORS_ORIGINS` | Allowed CRM domains | `https://your-crm.app, https://localhost:5173` |

> [!TIP]
> Generate a secure API key using: `openssl rand -hex 32`

---

## 2. ⚡ Supabase Edge Function Configuration
Update the secrets in your Supabase project so the `telephony-callback` function knows where to send requests.

Run these via Supabase CLI or add them in the **Dashboard → Edge Functions → Secrets**:
1. `FREEPBX_API_URL`: `https://your-pbx-domain.com`
2. `FREEPBX_API_KEY`: The same key from your server's `.env`

---

## 3. ⚙️ CRM Settings Interface
Verify the connection through the CRM user interface.

1.  Open **Settings → Telephony**.
2.  **Enable Telephony**: Toggle the switch to "On".
3.  **PBX Server URL**: Paste your server's public URL.
4.  **API Key**: Paste the key generated in Step 1.
5.  **Internal Number**: Set a default extension (e.g., `101`).
6.  **Test Connection**: Click the button and check for a green success message.

---

## 4. 📞 Manager Extensions Setup
Each manager needs a specific extension mapped to their CRM account.

1.  In the Telephony Settings page, scroll to **Manager Extensions**.
2.  Assign an extension number (from FreePBX) to each active user.
3.  Ensure the "Is Active" toggle is enabled for them.

---

## 5. 🛡️ Security & Final Checklist
Before moving to full production, verify these items:

- [ ] **SSL (HTTPS)**: Ensure the API is running behind a secure certificate (Certbot).
- [ ] **Firewall (UFW)**: Port `80/443` (Public), Ports `5038/8088` (Internal Only).
- [ ] **Call Quality**: Test an outbound call from a Lead card — manager should ring first, then customer.
- [ ] **Recordings**: Check if `.mp3` files are uploading correctly to Supabase Storage.
- [ ] **History**: Verify calls appear in the CRM's **Telephony** page with correct durations.

---

## 🆘 Troubleshooting
If the "Test Connection" fails:
- Check server logs: `pm2 logs satubooster-telephony`
- Verify that **Asterisk AMI** is enabled in `/etc/asterisk/manager.conf`.
- Ensure the `CORS_ORIGINS` in `.env` includes your CRM's URL.
