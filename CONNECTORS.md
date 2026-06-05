# FRIDAY — Connecting Gmail, Calendar & Slack

You do this **once, as the owner of FRIDAY**. After that, you (and anyone you deploy
this to, at any company) just click **Connect** in the app and sign in — no setup on their end.

It takes ~10 minutes. Your only job is to copy 4 values into `.env`.

After editing `.env`, **restart the server** (`npm run dev`) so it picks up the new values.

---

## 1. Google (covers both Gmail *and* Calendar — one app)

1. Go to <https://console.cloud.google.com/> and create a project (top bar → New Project). Name it `FRIDAY`.
2. **Enable the three APIs** — search each in the top bar, open it, click **Enable**:
   - "Gmail API"
   - "Google Calendar API"
   - "Google Sheets API"   ← FRIDAY's memory store
3. **OAuth consent screen** (left menu → *APIs & Services → OAuth consent screen*):
   - User type: **External** → Create.
   - App name `FRIDAY`, your email for support + developer contact. Save & continue.
   - **Scopes**: skip (we request them from code). Save & continue.
   - **Test users**: click *Add Users* and add every Google account that will sign in
     (yours, teammates'). In Testing mode only these accounts can connect — that's fine.
   - Save.
4. **Create the credential** (left menu → *Credentials → Create Credentials → OAuth client ID*):
   - Application type: **Web application**.
   - Name: `FRIDAY`.
   - **Authorized redirect URI** — add exactly:
     ```
     http://localhost:3001/api/auth/google/callback
     ```
   - Create. A dialog shows your **Client ID** and **Client secret**.
5. Paste them into `.env`:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```

Restart the server, open FRIDAY, click **Connect Gmail** (or **Connect Calendar** — same
sign-in). Approve the consent screen. Both light up green. ✅

> On the consent screen you may see *"Google hasn't verified this app."* That's expected
> for an app in Testing mode — click *Advanced → Go to FRIDAY (unsafe)*. It's your own app.
> To remove that warning later, submit the app for verification (only needed for public launch).

---

## 2. Slack

1. Go to <https://api.slack.com/apps> → **Create New App** → *From scratch*.
   Name `FRIDAY`, pick your workspace.
2. Left menu → **OAuth & Permissions**:
   - Under **Redirect URLs**, add exactly:
     ```
     http://localhost:3001/api/auth/slack/callback
     ```
     Save URLs.
   - Under **User Token Scopes** (not Bot scopes), add:
     - `search:read`
     - `users:read`
3. Left menu → **Basic Information → App Credentials**. Copy **Client ID** and **Client Secret**
   into `.env`:
   ```
   SLACK_CLIENT_ID=...
   SLACK_CLIENT_SECRET=...
   ```

Restart the server, click **Connect Slack**, approve. ✅

---

## 3. Use it

Click **sync** (top right) or **generate briefing**. FRIDAY pulls:
- **Gmail** — important/unread mail from the last 2 days
- **Calendar** — today's events
- **Slack** — recent mentions of you

…and the AI turns it into your daily briefing.

**Memory:** once Google is connected, FRIDAY auto-creates a **"FRIDAY Memory"** spreadsheet
in your Google Drive and logs its data there (completed tasks, daily focus, decisions,
patterns). Click **memory sheet ↗** in the footer to open it — it's yours to read and edit.

---

## Deploying to another company / domain

The OAuth apps above are yours and work for everyone — no per-user setup. When you host
FRIDAY somewhere other than `localhost`, just:
1. Set `OAUTH_REDIRECT_BASE` and `APP_BASE` in `.env` to the real URLs.
2. Add the matching `…/api/auth/google/callback` and `…/api/auth/slack/callback` to the
   redirect URIs in the Google and Slack consoles.

That's the whole story — one setup, reused everywhere.
