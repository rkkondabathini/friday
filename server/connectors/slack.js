/**
 * FRIDAY — Slack connector
 * OAuth v2 user token. Pulls recent mentions (highest signal for a briefing).
 */

const axios = require("axios");
const db = require("../db");

const REDIRECT_BASE = process.env.OAUTH_REDIRECT_BASE || "http://localhost:3001";
const REDIRECT_URI = `${REDIRECT_BASE}/api/auth/slack/callback`;

// User-token scopes: read as the signed-in person
const USER_SCOPES = ["search:read", "users:read"];

const isConfigured = () =>
  !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);

// Step 1 — consent URL
const getAuthUrl = () => {
  const p = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    user_scope: USER_SCOPES.join(","),
    redirect_uri: REDIRECT_URI,
  });
  return `https://slack.com/oauth/v2/authorize?${p.toString()}`;
};

// Step 2 — exchange code for a user token
const handleCallback = async (code) => {
  const res = await axios.post(
    "https://slack.com/api/oauth.v2.access",
    new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const d = res.data;
  if (!d.ok) throw new Error(`slack oauth: ${d.error}`);

  const tokens = {
    access_token: d.authed_user.access_token,
    user_id: d.authed_user.id,
    scope: d.authed_user.scope,
    team_id: d.team?.id,
  };
  const account = d.team?.name || d.team?.id || null;
  db.saveConnection("slack", tokens, account);
  return { team: account };
};

const call = async (token, method, params = {}) => {
  const res = await axios.get(`https://slack.com/api/${method}`, {
    params,
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
};

// Recent mentions of the signed-in user (last 2 days)
const fetchSlack = async (max = 15) => {
  const conn = db.getConnection("slack");
  if (!conn) return [];
  const token = conn.tokens.access_token;

  // Resolve own handle so we can search for mentions
  let handle = null;
  try {
    const me = await call(token, "users.info", { user: conn.tokens.user_id });
    if (me.ok) handle = me.user?.name;
  } catch { /* non-fatal */ }
  if (!handle) return [];

  const since = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
  let res;
  try {
    res = await call(token, "search.messages", {
      query: `@${handle} after:${since}`,
      count: max,
      sort: "timestamp",
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  return (res.messages?.matches || []).map((m) => ({
    id: m.iid || m.ts,
    user: m.username,
    channel: m.channel?.name,
    text: m.text,
    ts: m.ts,
    slack_url: m.permalink,
  }));
};

// Resolve my own Slack handle
const myHandle = async (token, userId) => {
  try { const me = await call(token, "users.info", { user: userId }); return me.ok ? me.user?.name : null; }
  catch { return null; }
};

// OPEN LOOPS — messages where I was tagged, flagged by whether I replied in-thread.
// Uses conversations.replies (precise) to detect my reply; no manual tracking.
const fetchSlackOpenLoops = async (max = 20, days = 4) => {
  const conn = db.getConnection("slack");
  if (!conn) return [];
  const token = conn.tokens.access_token;
  const myId = conn.tokens.user_id;
  const handle = await myHandle(token, myId);
  if (!handle) return [];

  const since = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

  // Pull mentions of me AND my own recent sent messages in parallel. The sent
  // messages let us catch CHANNEL-level replies (not just threaded ones), which
  // conversations.replies alone would miss.
  const [res, mineRes] = await Promise.all([
    call(token, "search.messages", { query: `@${handle} after:${since}`, count: max, sort: "timestamp" }).catch(() => ({ ok: false })),
    call(token, "search.messages", { query: `from:@${handle} after:${since}`, count: 100, sort: "timestamp" }).catch(() => ({ ok: false })),
  ]);
  if (!res.ok) return [];

  // channel name → sorted list of my message timestamps in that channel
  const myMsgsByChannel = {};
  for (const mm of (mineRes.messages?.matches || [])) {
    const ch = mm.channel?.name;
    if (!ch) continue;
    (myMsgsByChannel[ch] = myMsgsByChannel[ch] || []).push(Number(mm.ts));
  }
  const repliedInChannelAfter = (channel, ts) =>
    (myMsgsByChannel[channel] || []).some(t => t > Number(ts));

  // Drop automation/bot posts and messages that actually @-tag SOMEONE ELSE (not me)
  // — both show up in search noise but aren't really loops on me.
  const myTag = `<@${myId}`;
  const looksAutomated = (u = "") => /bot|request|notification|reminder|workflow|noreply|trigger|alert|digest/i.test(u);
  const seen = new Set();
  const relevant = (res.messages?.matches || []).filter((m) => {
    if (looksAutomated(m.username || "")) return false;
    // if the message tags people but NOT me, it's not my loop
    const tagsSomeone = /<@[A-Z0-9]+/i.test(m.text || "");
    if (tagsSomeone && !(m.text || "").includes(myTag)) return false;
    const key = `${m.channel?.name}|${(m.text || "").slice(0, 60)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return Promise.all(relevant.map(async (m) => {
    const channelId = m.channel?.id;
    const channelName = m.channel?.name;
    let replied = repliedInChannelAfter(channelName, m.ts); // channel-level reply
    if (!replied) {
      try {
        const rep = await call(token, "conversations.replies", { channel: channelId, ts: m.ts, limit: 50 });
        if (rep.ok) replied = (rep.messages || []).some(r => r.user === myId && Number(r.ts) > Number(m.ts));
      } catch { /* no history access for this channel — treat as open */ }
    }
    return {
      id: m.iid || m.ts,
      channel: m.channel?.name,
      user: m.username,
      text: m.text,
      ts: m.ts,
      ageHours: Math.max(0, Math.round((Date.now() / 1000 - Number(m.ts)) / 3600)),
      slack_url: m.permalink,
      replied,
    };
  }));
};

module.exports = { isConfigured, getAuthUrl, handleCallback, fetchSlack, fetchSlackOpenLoops, USER_SCOPES };
