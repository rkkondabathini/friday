/**
 * FRIDAY — Google connector (Gmail + Calendar)
 * One OAuth app covers both. Tokens are stored per-install in SQLite.
 */

const db = require("../db");

const REDIRECT_BASE = process.env.OAUTH_REDIRECT_BASE || "http://localhost:3001";
const REDIRECT_URI = `${REDIRECT_BASE}/api/auth/google/callback`;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/spreadsheets",   // FRIDAY memory store
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

const MEMORY_SHEET_KEY = "memory_spreadsheet_id";
const MEMORY_HEADERS = ["timestamp", "type", "content"];

const isConfigured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// Build a bare OAuth2 client (no tokens yet)
const oauthClient = () => {
  const { google } = require("googleapis");
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
};

// Step 1 — consent URL
const getAuthUrl = () =>
  oauthClient().generateAuthUrl({
    access_type: "offline",      // get a refresh_token
    prompt: "consent",           // force refresh_token on re-connect
    scope: SCOPES,
  });

// Step 2 — exchange code, persist tokens + account email
const handleCallback = async (code) => {
  const { google } = require("googleapis");
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  let email = null;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const me = await oauth2.userinfo.get();
    email = me.data.email;
  } catch { /* non-fatal */ }

  db.saveConnection("google", tokens, email);
  return { email };
};

// Authorized client using stored tokens; persists refreshed tokens automatically
const authedClient = () => {
  const conn = db.getConnection("google");
  if (!conn) return null;
  const client = oauthClient();
  client.setCredentials(conn.tokens);
  client.on("tokens", (fresh) => {
    // Google only re-sends refresh_token sometimes — merge, don't clobber
    const merged = { ...conn.tokens, ...fresh };
    db.saveConnection("google", merged, conn.account);
  });
  return client;
};

const decodeHeader = (headers, name) =>
  (headers.find((h) => h.name.toLowerCase() === name.toLowerCase()) || {}).value || "";

// Recent, high-signal inbox messages (last 2 days, primary/important)
const fetchGmail = async (max = 15) => {
  const { google } = require("googleapis");
  const auth = authedClient();
  if (!auth) return [];
  const gmail = google.gmail({ version: "v1", auth });

  const list = await gmail.users.messages.list({
    userId: "me",
    q: "newer_than:2d -category:promotions -category:social",
    maxResults: max,
  });
  const ids = (list.data.messages || []).map((m) => m.id);

  const msgs = await Promise.all(
    ids.map((id) =>
      gmail.users.messages
        .get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] })
        .then((r) => {
          const h = r.data.payload.headers || [];
          return {
            id,
            from: decodeHeader(h, "From"),
            subject: decodeHeader(h, "Subject"),
            date: decodeHeader(h, "Date"),
            snippet: r.data.snippet,
            unread: (r.data.labelIds || []).includes("UNREAD"),
            important: (r.data.labelIds || []).includes("IMPORTANT"),
          };
        })
        .catch(() => null)
    )
  );
  return msgs.filter(Boolean);
};

// Today's calendar events
const fetchCalendar = async () => {
  const { google } = require("googleapis");
  const auth = authedClient();
  if (!auth) return [];
  const cal = google.calendar({ version: "v3", auth });

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);

  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });
  return (res.data.items || []).map((e) => ({
    id: e.id,
    title: e.summary || "(no title)",
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    attendees: (e.attendees || []).map((a) => a.email),
    location: e.location || "",
    hangoutLink: e.hangoutLink || "",
  }));
};

// OPEN LOOPS — inbox threads, flagged by whether YOU have replied. "Open" = the
// last message in the thread is not from you (it's on you). Also reports read vs
// unread, so FRIDAY can tell "consciously parked" from "not yet seen". No manual
// tracking — this is inferred from your actual mailbox.
const fetchGmailOpenLoops = async (days = 4, max = 25) => {
  const { google } = require("googleapis");
  const auth = authedClient();
  if (!auth) return [];
  const gmail = google.gmail({ version: "v1", auth });
  const myEmail = (db.getConnection("google")?.account || "").toLowerCase();

  const list = await gmail.users.threads.list({
    userId: "me",
    q: `newer_than:${days}d in:inbox -category:promotions -category:social -category:updates -category:forums`,
    maxResults: max,
  });
  const ids = (list.data.threads || []).map((t) => t.id);

  const loops = await Promise.all(
    ids.map((id) =>
      gmail.users.threads
        .get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] })
        .then((r) => {
          const msgs = r.data.messages || [];
          if (!msgs.length) return null;
          const last = msgs[msgs.length - 1];
          const first = msgs[0];
          const lastFrom = decodeHeader(last.payload.headers || [], "From").toLowerCase();
          const lastFromMe = !!myEmail && lastFrom.includes(myEmail);
          const repliedByMe = msgs.some((m) =>
            decodeHeader(m.payload.headers || [], "From").toLowerCase().includes(myEmail));
          return {
            id,
            from: decodeHeader(first.payload.headers || [], "From"),
            subject: decodeHeader(first.payload.headers || [], "Subject"),
            snippet: last.snippet || r.data.snippet || "",
            date: decodeHeader(last.payload.headers || [], "Date"),
            unread: (last.labelIds || []).includes("UNREAD"),
            messages: msgs.length,
            lastFromMe,
            repliedByMe,
          };
        })
        .catch(() => null)
    )
  );
  return loops.filter(Boolean);
};

// ── Backfill: wider history for semantic memory ────────────────

// Fetch up to `max` messages matching a Gmail query, as memory items
const fetchGmailQuery = async (q, max, label) => {
  const { google } = require("googleapis");
  const auth = authedClient();
  if (!auth) return [];
  const gmail = google.gmail({ version: "v1", auth });

  const ids = [];
  let pageToken;
  while (ids.length < max) {
    const list = await gmail.users.messages.list({
      userId: "me", q, maxResults: Math.min(100, max - ids.length), pageToken,
    });
    (list.data.messages || []).forEach((m) => ids.push(m.id));
    pageToken = list.data.nextPageToken;
    if (!pageToken) break;
  }

  const items = await Promise.all(
    ids.map((id) =>
      gmail.users.messages
        .get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] })
        .then((r) => {
          const h = r.data.payload.headers || [];
          const subject = decodeHeader(h, "Subject");
          const from = decodeHeader(h, "From");
          const to = decodeHeader(h, "To");
          const dateHdr = decodeHeader(h, "Date");
          const iso = dateHdr ? new Date(dateHdr).toISOString() : null;
          return {
            source: "gmail",
            ext_id: id,
            date: iso,
            title: `${label}: ${subject || "(no subject)"}`,
            text: `${label === "sent" ? "I wrote to " + to : "From " + from} — ${subject} — ${r.data.snippet || ""}`,
          };
        })
        .catch(() => null)
    )
  );
  return items.filter(Boolean);
};

// 60-day history: what landed in the inbox + what Ravi himself sent
const fetchGmailHistory = async (days = 60, maxEach = 300) => {
  const [received, sent] = await Promise.all([
    fetchGmailQuery(`newer_than:${days}d in:inbox -category:promotions -category:social`, maxEach, "received"),
    fetchGmailQuery(`newer_than:${days}d in:sent`, maxEach, "sent"),
  ]);
  return [...received, ...sent];
};

// Calendar events across a back-window (and the coming week)
const fetchCalendarHistory = async (daysBack = 60) => {
  const { google } = require("googleapis");
  const auth = authedClient();
  if (!auth) return [];
  const cal = google.calendar({ version: "v3", auth });
  const timeMin = new Date(Date.now() - daysBack * 86400000).toISOString();
  const timeMax = new Date(Date.now() + 7 * 86400000).toISOString();

  const items = [];
  let pageToken;
  do {
    const res = await cal.events.list({
      calendarId: "primary", timeMin, timeMax, singleEvents: true, orderBy: "startTime",
      maxResults: 250, pageToken,
    });
    (res.data.items || []).forEach((e) => {
      const start = e.start?.dateTime || e.start?.date;
      items.push({
        source: "calendar",
        ext_id: e.id,
        date: start ? new Date(start).toISOString() : null,
        title: e.summary || "(no title)",
        text: `Meeting: ${e.summary || "(no title)"}${(e.attendees || []).length ? " · with " + (e.attendees || []).map(a => a.email).join(", ") : ""}${e.description ? " · " + e.description.slice(0, 200) : ""}`,
      });
    });
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return items;
};

// ── Google Sheets: FRIDAY's memory store ───────────────────────

// Find (or create once) the "FRIDAY Memory" spreadsheet; remember its id locally
const ensureMemorySheet = async () => {
  const { google } = require("googleapis");
  const auth = authedClient();
  if (!auth) throw new Error("google not connected");
  const sheets = google.sheets({ version: "v4", auth });

  let id = db.getSetting(MEMORY_SHEET_KEY);
  if (id) {
    // Verify it still exists / is accessible
    try { await sheets.spreadsheets.get({ spreadsheetId: id, fields: "spreadsheetId" }); return id; }
    catch { id = null; }
  }

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: "FRIDAY Memory" },
      sheets: [{ properties: { title: "memory" } }],
    },
  });
  id = created.data.spreadsheetId;
  // Write header row
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: "memory!A1",
    valueInputOption: "RAW",
    requestBody: { values: [MEMORY_HEADERS] },
  });
  db.setSetting(MEMORY_SHEET_KEY, id);
  return id;
};

const sheetUrl = () => {
  const id = db.getSetting(MEMORY_SHEET_KEY);
  return id ? `https://docs.google.com/spreadsheets/d/${id}` : null;
};

// Append one memory row. Fire-and-forget friendly (throws on real failure).
const appendMemory = async (type, content) => {
  const { google } = require("googleapis");
  const auth = authedClient();
  if (!auth) return null;
  const sheets = google.sheets({ version: "v4", auth });
  const id = await ensureMemorySheet();
  await sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range: "memory!A:C",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[new Date().toISOString(), type, content]] },
  });
  return id;
};

// Append many rows at once (used for backfilling existing local memory)
const appendMemoryRows = async (rows) => {
  if (!rows.length) return sheetUrl();
  const { google } = require("googleapis");
  const auth = authedClient();
  if (!auth) return null;
  const sheets = google.sheets({ version: "v4", auth });
  const id = await ensureMemorySheet();
  await sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range: "memory!A:C",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows.map(r => [r.timestamp || new Date().toISOString(), r.type, r.content]) },
  });
  return sheetUrl();
};

// Read memory rows back (for recall / RAG)
const readMemory = async (limit = 200) => {
  const { google } = require("googleapis");
  const auth = authedClient();
  if (!auth) return [];
  const id = db.getSetting(MEMORY_SHEET_KEY);
  if (!id) return [];
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "memory!A2:C" });
  const rows = res.data.values || [];
  return rows.slice(-limit).map(([timestamp, type, content]) => ({ timestamp, type, content }));
};

module.exports = {
  isConfigured, getAuthUrl, handleCallback, fetchGmail, fetchCalendar, SCOPES,
  fetchGmailOpenLoops, fetchGmailHistory, fetchCalendarHistory,
  ensureMemorySheet, appendMemory, appendMemoryRows, readMemory, sheetUrl,
};
