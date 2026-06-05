/**
 * FRIDAY Outbox Queue
 *
 * The single place that decides "run now" vs "park it and retry later".
 * Anything that needs Claude (briefings, chat, profile…) can be enqueued. When
 * Claude is at its subscription usage limit, or the machine is offline, jobs sit
 * in the SQLite `outbox` table and this worker drains them automatically the
 * moment Claude is reachable again — an offline-sync style pipeline.
 *
 * Handlers are registered by index.js (which owns generateBriefing/chat/etc.),
 * so this module stays free of circular deps.
 */

const db = require("./db");

// How long to back off after hitting the usage limit when Claude DIDN'T tell us a
// reset time. Conservative so we don't hammer the limit. Overridable via .env.
const DEFAULT_LIMIT_COOLDOWN_MIN = Number(process.env.CLAUDE_LIMIT_COOLDOWN_MINUTES || 30);
// Retry cadence for plain offline/network errors (cheap — the spawn fails fast).
const OFFLINE_RETRY_MS = 60 * 1000;
const TICK_MS = 15 * 1000;
// Offline can be misclassified, so don't retry forever — give up after this many.
const MAX_OFFLINE_ATTEMPTS = 15;

let handlers = {};
let processing = false;
let offlineUntil = 0; // epoch ms — short network back-off

// ── Claude availability (rate-limit gate) ─────────────────────
// Persisted so a server restart still respects an active limit window.
const blockedUntilMs = () => {
  const v = db.getSetting("claude_blocked_until");
  return v ? new Date(v).getTime() : 0;
};
const isClaudeBlocked = () => Date.now() < blockedUntilMs();
const isOfflineBackoff = () => Date.now() < offlineUntil;

const blockClaude = (resetAt) => {
  const until = resetAt
    ? new Date(resetAt)
    : new Date(Date.now() + DEFAULT_LIMIT_COOLDOWN_MIN * 60 * 1000);
  db.setSetting("claude_blocked_until", until.toISOString());
  console.log(`⛔ Claude usage limit — pausing generation until ${until.toLocaleString()}`);
  return until.toISOString();
};
const clearClaudeBlock = () => db.setSetting("claude_blocked_until", "");

// ── Public API ────────────────────────────────────────────────
const register = (h) => { handlers = { ...handlers, ...h }; };

// Enqueue a job. `dedupeKind` avoids piling up duplicates (e.g. many sync clicks).
const enqueue = (kind, payload = {}, { dedupe = true } = {}) => {
  if (dedupe && db.hasPendingOutbox(kind)) {
    const existing = db.nextPendingOutbox();
    return { id: existing?.id, deduped: true };
  }
  const id = db.enqueueOutbox(kind, payload);
  setImmediate(tick); // try to run right away if Claude is free
  return { id, deduped: false };
};

const status = () => {
  const until = blockedUntilMs();
  return {
    claudeBlocked: isClaudeBlocked(),
    blockedUntil: until ? new Date(until).toISOString() : null,
    offline: isOfflineBackoff(),
    pending: db.countPendingOutbox(),
  };
};

// ── The worker ────────────────────────────────────────────────
const tick = async () => {
  if (processing) return;
  if (isClaudeBlocked() || isOfflineBackoff()) return; // wait for reset / network
  const job = db.nextPendingOutbox();
  if (!job) return;
  const handler = handlers[job.kind];
  if (!handler) { db.markOutboxFailed(job.id, `no handler for "${job.kind}"`); return; }

  processing = true;
  try {
    const result = await handler(job.payload);
    db.markOutboxDone(job.id, result ?? { ok: true });
    clearClaudeBlock(); // a success proves Claude is back — open the gate
    offlineUntil = 0;
    setImmediate(tick); // drain the rest of the queue
  } catch (e) {
    if (e && e.isClaudeLimit) {
      // Real rate-limit: pause Claude entirely and keep the job pending. No further
      // calls happen until the limit resets, so this costs no extra tokens.
      blockClaude(e.resetAt);
      db.bumpOutboxAttempt(job.id, e.message);
    } else if (e && e.isOffline) {
      // Network/Claude unreachable: the spawn fails fast (no tokens spent). Retry
      // on a slow cadence, but give up eventually in case it's a misclassification.
      offlineUntil = Date.now() + OFFLINE_RETRY_MS;
      db.bumpOutboxAttempt(job.id, e.message);
      if ((job.attempts || 0) + 1 >= MAX_OFFLINE_ATTEMPTS) db.markOutboxFailed(job.id, e.message);
    } else {
      // Genuine error (e.g. bad JSON from a generation). DO NOT retry — each retry is
      // a full, expensive Claude call. Fail fast; the next sync/auto-refresh makes a
      // fresh job. This is what previously caused an 8x retry token storm.
      db.markOutboxFailed(job.id, e.message || String(e));
      console.warn(`queue: job ${job.id} (${job.kind}) failed, not retrying — ${e.message || e}`);
    }
  } finally {
    processing = false;
  }
};

const start = () => {
  setInterval(() => { tick().catch(err => console.warn("queue tick failed:", err.message)); }, TICK_MS);
  setImmediate(tick);
};

module.exports = {
  register, enqueue, start, status, tick,
  isClaudeBlocked, blockClaude, clearClaudeBlock,
};
