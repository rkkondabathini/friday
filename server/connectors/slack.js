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

module.exports = { isConfigured, getAuthUrl, handleCallback, fetchSlack, USER_SCOPES };
