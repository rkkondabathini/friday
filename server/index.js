/**
 * FRIDAY Express Server
 * Handles AI chat, briefing storage, task management, and n8n webhooks
 */

require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const ai = require("./ai");
const { chat, generateBriefing } = ai;
const db = require("./db");
const queue = require("./queue");
const google = require("./connectors/google");
const slack = require("./connectors/slack");
const rag = require("./rag");

const app = express();
const PORT = process.env.PORT || 3001;
const APP_BASE = process.env.APP_BASE || "http://localhost:5173";

const connectors = { google, slack };

// User's local date (YYYY-MM-DD) — used for per-day usage/throttle accounting.
const USER_TZ = (require("../src/context.json").user || {}).timezone || "Asia/Kolkata";
const todayInTz = () => new Date().toLocaleDateString("en-CA", { timeZone: USER_TZ });

// Ravi triages email with his OWN Gmail labels — they're the source of truth.
// Map a thread's label names → state: done | action | waiting | fyi | null.
const EMAIL_LABELS = (require("../src/context.json").email_labels) || {};
const emailLabelState = (labels = []) => {
  const has = (set) => (set || []).some((n) => labels.includes(n));
  if (has(EMAIL_LABELS.done))    return "done";
  if (has(EMAIL_LABELS.action))  return "action";
  if (has(EMAIL_LABELS.waiting)) return "waiting";
  if (has(EMAIL_LABELS.fyi))     return "fyi";
  return null;
};

// Record every real Claude call's tokens + cost (reported by the CLI's JSON output).
ai.setUsageSink((u) => { try { db.addUsage(u, todayInTz()); } catch (e) { console.warn("usage track failed:", e.message); } });

// Record a memory locally AND mirror it to the Google Sheet (best-effort)
const logMemory = (type, content) => {
  db.addMemory(type, content);
  if (db.getConnection("google")) {
    google.appendMemory(type, content).catch(e => console.warn("sheet memory sync failed:", e.message));
  }
};

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ── Health check ───────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", provider: process.env.AI_PROVIDER || "openai", version: "1.0.0" });
});

// ── Briefing endpoints ─────────────────────────────────────────

// GET today's briefing (or latest)
app.get("/api/briefing", (req, res) => {
  const date = req.query.date || new Date().toISOString().split("T")[0];
  const briefing = db.getBriefing(date) || db.getLatestBriefing();
  const overrides = db.getTaskOverrides();
  const customTasks = db.getCustomTasks();
  res.json({ briefing, overrides, customTasks });
});

// GET briefing history
app.get("/api/briefing/history", (req, res) => {
  const history = db.getBriefingHistory(7);
  res.json({ history });
});

// POST save a briefing (called by n8n or manually)
app.post("/api/briefing", (req, res) => {
  // Optional: verify n8n webhook secret
  const secret = req.headers["x-friday-secret"];
  if (process.env.N8N_WEBHOOK_SECRET && secret !== process.env.N8N_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { briefing, date, source } = req.body;
  if (!briefing) return res.status(400).json({ error: "briefing required" });
  const d = date || new Date().toISOString().split("T")[0];
  db.saveBriefing(d, briefing, source || "n8n");
  res.json({ ok: true, date: d });
});

// POST generate a fresh briefing from raw data
app.post("/api/briefing/generate", async (req, res) => {
  try {
    const { gmail, calendar, slack } = req.body;
    const carryForward = db.getCarryForwardTasks();
    const directives = db.getDirectives().map(d => d.text);
    const briefing = await generateBriefing(gmail || [], calendar || [], slack || [], carryForward, directives);
    const date = new Date().toISOString().split("T")[0];
    db.saveBriefing(date, briefing, "generated");
    res.json({ ok: true, briefing, date });
  } catch (e) {
    console.error("Briefing generation error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ── Task endpoints ─────────────────────────────────────────────

// PATCH update task status
app.patch("/api/tasks/:id/status", (req, res) => {
  const { status } = req.body;
  const validStatuses = ["Not Started", "In Progress", "Waiting on Others", "Completed"];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: "invalid status" });
  db.setTaskStatus(req.params.id, status);

  // Track pattern: if task is completed, log it
  if (status === "Completed") {
    logMemory("task_completed", `Task ${req.params.id} completed`);
  }
  res.json({ ok: true });
});

// GET all task overrides
app.get("/api/tasks/overrides", (req, res) => {
  res.json({ overrides: db.getTaskOverrides() });
});

// POST add custom task
app.post("/api/tasks/custom", (req, res) => {
  const task = req.body;
  if (!task.id || !task.task) return res.status(400).json({ error: "id and task required" });
  db.saveCustomTask(task);
  res.json({ ok: true, task });
});

// GET custom tasks
app.get("/api/tasks/custom", (req, res) => {
  res.json({ tasks: db.getCustomTasks() });
});

// DELETE custom task
app.delete("/api/tasks/custom/:id", (req, res) => {
  db.deleteCustomTask(req.params.id);
  res.json({ ok: true });
});

// Build FRIDAY's full context for a chat turn and call the engine. Shared by the
// live endpoint and the queued-chat job (used when Claude was at its limit).
const buildAndChat = async (messages, briefingContext) => {
    const recentMemory = db.getRecentMemory(10);
    const patterns = db.getTopPatterns(5);
    const carryForward = db.getCarryForwardTasks();

    // Semantic recall: pull the most relevant learned history for this question
    let recalled = [];
    try {
      const lastUser = [...messages].reverse().find(m => m.role === "user");
      if (lastUser) recalled = await rag.recall(lastUser.content, 6);
    } catch (e) { console.warn("recall failed:", e.message); }

    const profile = db.getSetting("professional_profile");
    const orgMap = db.getSetting("org_map");
    const directives = db.getDirectives();

    const extraContext = `
${directives.length ? `STANDING PRIORITIES & DIRECTIVES (things ${"Ravi"} told you to always keep in mind — weight heavily):\n${directives.map(d => `- ${d.text}`).join("\n")}\n` : ""}
${orgMap ? `ORG STRUCTURE (who's who at Masai):\n${orgMap}\n` : ""}
${profile ? `PROFESSIONAL PROFILE (learned from history):\n${profile}\n` : ""}
RELEVANT HISTORY (semantically recalled from your email/calendar/slack):
${recalled.length ? rag.formatRecall(recalled) : "None yet"}

CURRENT BRIEFING CONTEXT:
${JSON.stringify(briefingContext || {})}

RECENT MEMORY (last 10 events):
${recentMemory.map(m => `[${m.date}] ${m.type}: ${m.content}`).join("\n")}

TOP PATTERNS OBSERVED:
${patterns.map(p => `- "${p.pattern}" (${p.occurrences}x, last seen ${p.last_seen})`).join("\n")}

CARRY-FORWARD TASKS FROM YESTERDAY:
${carryForward.map(t => `- [${t.priority}] ${t.task} (${t.status})`).join("\n") || "None"}
    `.trim();

    return chat(messages, extraContext);
};

// ── Chat endpoint ──────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, briefingContext } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages array required" });

    // If Claude is already known to be at its limit, queue immediately — don't
    // make the user wait for a call we know will fail.
    if (queue.isClaudeBlocked()) {
      const { id } = queue.enqueue("chat", { messages, briefingContext }, { dedupe: false });
      return res.json({ queued: true, jobId: id, ...queue.status() });
    }

    try {
      const reply = await buildAndChat(messages, briefingContext);
      res.json({ reply });
    } catch (e) {
      // Hit the limit / went offline mid-request → park it and let the user know.
      if (e && (e.isClaudeLimit || e.isOffline)) {
        if (e.isClaudeLimit) queue.blockClaude(e.resetAt);
        const { id } = queue.enqueue("chat", { messages, briefingContext }, { dedupe: false });
        return res.json({ queued: true, jobId: id, ...queue.status() });
      }
      throw e;
    }
  } catch (e) {
    console.error("Chat error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ── Memory endpoint ────────────────────────────────────────────
app.post("/api/memory", (req, res) => {
  const { type, content } = req.body;
  if (!type || !content) return res.status(400).json({ error: "type and content required" });
  logMemory(type, content);
  res.json({ ok: true });
});

// Where is FRIDAY's memory sheet? (does not create — just reports)
app.get("/api/memory/sheet", (req, res) => {
  res.json({ url: google.sheetUrl(), connected: !!db.getConnection("google") });
});

// Push all existing local memory into the sheet (one-time catch-up)
app.post("/api/memory/backfill", async (req, res) => {
  try {
    if (!db.getConnection("google")) return res.status(400).json({ error: "google not connected" });
    const mem = db.getRecentMemory(1000)
      .map(m => ({ timestamp: m.created_at, type: m.type, content: m.content }))
      .reverse();
    const url = await google.appendMemoryRows(mem);
    res.json({ ok: true, count: mem.length, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Directives: standing priorities the user tells FRIDAY to keep ──
app.get("/api/directives", (req, res) => {
  res.json({ directives: db.getDirectives() });
});

app.post("/api/directives", (req, res) => {
  const { text, tag } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "text required" });
  const id = db.addDirective(text.trim(), tag || null);
  logMemory("directive", `Standing priority added: ${text.trim()}`);
  res.json({ ok: true, id, directives: db.getDirectives() });
});

app.delete("/api/directives/:id", (req, res) => {
  db.deleteDirective(Number(req.params.id));
  res.json({ ok: true, directives: db.getDirectives() });
});

// ── Semantic memory (RAG) ──────────────────────────────────────

// Stats: how much has FRIDAY learned
app.get("/api/memory/stats", (req, res) => {
  res.json(db.countVectors());
});

// Ingest arbitrary items into memory: [{ source, ext_id, date, title, text }]
app.post("/api/memory/ingest", async (req, res) => {
  try {
    const items = req.body.items || [];
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items[] required" });
    const valid = items.filter(it => it && it.source && it.ext_id && it.text);
    const result = await rag.ingest(valid);
    res.json({ ok: true, ...result, totals: db.countVectors() });
  } catch (e) {
    console.error("ingest error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Backfill Gmail + Calendar history straight from the Google connector
app.post("/api/memory/backfill/google", async (req, res) => {
  try {
    if (!db.getConnection("google")) return res.status(400).json({ error: "google not connected" });
    const days = Number(req.body.days) || 60;
    const [mail, cal] = await Promise.all([
      google.fetchGmailHistory(days, Number(req.body.maxEmails) || 300),
      google.fetchCalendarHistory(days),
    ]);
    const result = await rag.ingest([...mail, ...cal]);
    res.json({ ok: true, fetched: { gmail: mail.length, calendar: cal.length }, ...result, totals: db.countVectors() });
  } catch (e) {
    console.error("google backfill error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Recall test / API: most relevant memories for a query
app.get("/api/memory/recall", async (req, res) => {
  try {
    const items = await rag.recall(req.query.q || "", Number(req.query.k) || 6);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Synthesize a professional profile from the corpus and store it
app.post("/api/memory/profile", async (req, res) => {
  try {
    const sample = db.sampleVectorText(140);
    if (!sample.length) return res.status(400).json({ error: "no memory to profile yet" });
    const corpus = sample.map(s => `[${s.source}] ${s.title || ""} ${s.text}`.slice(0, 300)).join("\n");
    const prompt = `Below is a sample of ${sample.length} recent work items (emails, meetings, Slack) for this operations leader. Write a concise professional profile in Markdown with these sections:
- **What I own day-to-day** (recurring responsibilities)
- **Key stakeholders & how I work with them**
- **Recurring themes & priorities**
- **Working patterns** (where my time goes, what I delegate vs handle)
- **Growth opportunities** (1-3 specific, evidence-based suggestions)

Be specific and grounded in the data. No preamble.\n\nWORK ITEMS:\n${corpus}`;
    const profile = await chat([{ role: "user", content: prompt }], "", 1500);
    db.setSetting("professional_profile", profile);
    logMemory("profile", "Professional profile synthesized from " + sample.length + " items");
    res.json({ ok: true, profile });
  } catch (e) {
    console.error("profile error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/memory/profile", (req, res) => {
  res.json({ profile: db.getSetting("professional_profile") });
});

// ── n8n webhook (incoming briefings from automation) ──────────
app.post("/webhook/briefing", (req, res) => {
  const secret = req.headers["x-friday-secret"];
  if (process.env.N8N_WEBHOOK_SECRET && secret !== process.env.N8N_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { briefing, date } = req.body;
  if (!briefing) return res.status(400).json({ error: "briefing required" });
  db.saveBriefing(date || new Date().toISOString().split("T")[0], briefing, "n8n");
  console.log("✅ Briefing received from n8n:", date);
  res.json({ ok: true });
});

// ── Patterns endpoint ──────────────────────────────────────────
app.get("/api/patterns", (req, res) => {
  res.json({ patterns: db.getTopPatterns(10) });
});

// ── Connections / OAuth ────────────────────────────────────────

// Status of every provider: is it set up (has client id) + is it connected
app.get("/api/connections", (req, res) => {
  const connected = Object.fromEntries(db.getConnections().map(c => [c.provider, c]));
  const status = Object.entries(connectors).map(([provider, c]) => ({
    provider,
    configured: c.isConfigured(),
    connected: !!connected[provider],
    account: connected[provider]?.account || null,
  }));
  res.json({ connections: status });
});

// Step 1 — kick off the OAuth dance
app.get("/api/auth/:provider", (req, res) => {
  const c = connectors[req.params.provider];
  if (!c) return res.status(404).json({ error: "unknown provider" });
  if (!c.isConfigured()) {
    return res
      .status(400)
      .send(`<h3>${req.params.provider} is not set up yet</h3>
        <p>Add its CLIENT_ID and CLIENT_SECRET to <code>.env</code>, then restart the server. See <code>CONNECTORS.md</code>.</p>`);
  }
  res.redirect(c.getAuthUrl());
});

// Step 2 — provider redirects back here with a code
app.get("/api/auth/:provider/callback", async (req, res) => {
  const c = connectors[req.params.provider];
  if (!c) return res.status(404).send("unknown provider");
  const { code, error } = req.query;
  if (error) return res.redirect(`${APP_BASE}/?connect=${req.params.provider}&status=denied`);
  if (!code) return res.redirect(`${APP_BASE}/?connect=${req.params.provider}&status=error`);
  try {
    await c.handleCallback(code);
    res.redirect(`${APP_BASE}/?connect=${req.params.provider}&status=ok`);
  } catch (e) {
    console.error(`${req.params.provider} OAuth error:`, e.message);
    res.redirect(`${APP_BASE}/?connect=${req.params.provider}&status=error`);
  }
});

// Disconnect a provider
app.delete("/api/connections/:provider", (req, res) => {
  db.deleteConnection(req.params.provider);
  res.json({ ok: true });
});

// ── Sync: cache-style. Only (re)generate when inputs actually changed. ──
// A fingerprint of the current inputs (mail/calendar/slack). If it matches the
// last run, we serve the stored briefing untouched — no Claude call.
const inputSignature = (gmail, calendar, slack) => {
  const payload = JSON.stringify({
    g: (gmail || []).map(m => m.id).sort(),
    c: (calendar || []).map(e => `${e.id}:${e.start}`).sort(),
    s: (slack || []).map(m => (m.id || m.text || "").slice(0, 60)).sort(),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
};

// Pull current inputs from connected sources (+ any injected slack)
const gatherInputs = async (slackInput = null) => {
  const conns = Object.fromEntries(db.getConnections().map(c => [c.provider, true]));
  const injectedSlack = Array.isArray(slackInput) ? slackInput : null;
  const [gmail, calendar, nativeSlack] = await Promise.all([
    conns.google ? google.fetchGmail() : Promise.resolve([]),
    conns.google ? google.fetchCalendar() : Promise.resolve([]),
    (!injectedSlack && conns.slack) ? slack.fetchSlack() : Promise.resolve([]),
  ]);
  const slackMsgs = injectedSlack || nativeSlack;
  return { gmail, calendar, slackMsgs, hasSource: !!(conns.google || conns.slack || injectedSlack) };
};

// ── Open Loops: what's still on YOU (tagged/emailed, not replied) — inferred from
// your real behaviour, no manual tracking. Cached briefly (Slack/Gmail API-heavy). ──
let _openLoopsCache = { at: 0, data: null };
const OPEN_LOOPS_TTL_MS = 3 * 60 * 1000;
const gatherOpenLoops = async (force = false) => {
  if (!force && _openLoopsCache.data && Date.now() - _openLoopsCache.at < OPEN_LOOPS_TTL_MS) return _openLoopsCache.data;
  const conns = Object.fromEntries(db.getConnections().map(c => [c.provider, true]));
  // Each source degrades independently — a dead Google token must NOT blank out
  // Slack loops or local captured items. Track failures so the UI can flag a reconnect.
  const srcErrors = {};
  const [email, slackTags] = await Promise.all([
    conns.google ? google.fetchGmailOpenLoops().catch(e => { srcErrors.google = e.message || "failed"; return []; }) : Promise.resolve([]),
    conns.slack  ? slack.fetchSlackOpenLoops().catch(e => { srcErrors.slack = e.message || "failed"; return []; })  : Promise.resolve([]),
  ]);
  // Email triage respects Ravi's OWN labels first, then To-vs-Cc. A thread he has
  // labelled "done" (Base Secured) is resolved → never an open loop. It needs his
  // reply if he tagged it an action label, OR he's directly addressed (To) and it
  // isn't tagged waiting/FYI. Cc-only / waiting / FYI stay off the "needs reply" count.
  const st = (t) => emailLabelState(t.labels);
  const live = email.filter(t => !t.lastFromMe && st(t) !== "done");
  const awaitingMe = live.filter(t => st(t) === "action" || (t.addressedToMe && st(t) !== "waiting" && st(t) !== "fyi"));
  const ccFyi      = live.filter(t => !awaitingMe.includes(t));   // open but FYI / waiting / just Cc'd
  const emailOpen = awaitingMe
    .sort((a, b) => (b.unread - a.unread) || (new Date(b.date) - new Date(a.date)))
    .slice(0, 12);
  const slackOpen = slackTags.filter(m => !m.replied);
  const emailOpenTotal = awaitingMe.length;
  const manual = db.getManualLoops(false); // open in-person/ad-hoc items
  const data = {
    slack: slackTags, email,
    slackOpen, emailOpen, manual,
    summary: {
      slackOpen: slackOpen.length, slackClosed: slackTags.length - slackOpen.length,
      emailOpen: emailOpenTotal, emailClosed: email.length - emailOpenTotal,
      emailUnread: awaitingMe.filter(t => t.unread).length,
      emailShown: emailOpen.length,
      emailCcFyi: ccFyi.length,   // only Cc'd — surfaced as a count, not as action
      manual: manual.length,
    },
    errors: srcErrors,
    at: new Date().toISOString(),
  };
  _openLoopsCache = { at: Date.now(), data };
  return data;
};

// ── Queue jobs ─────────────────────────────────────────────────
// The briefing job re-gathers FRESH inputs at run time, so a job parked during a
// usage-limit window reflects reality when it finally runs (offline-sync style).
const runBriefingJob = async ({ force = false } = {}) => {
  const { gmail, calendar, slackMsgs, hasSource } = await gatherInputs(null);
  if (!hasSource) return { ok: false, skipped: "no sources connected" };
  const date = new Date().toISOString().split("T")[0];
  const sig = inputSignature(gmail, calendar, slackMsgs);
  const existing = db.getBriefing(date);
  if (!force && existing && db.getSetting("input_signature") === sig) return { ok: true, cached: true, date };
  const carryForward = db.getCarryForwardTasks();
  const directives = db.getDirectives().map(d => d.text);
  const learnedTopics = JSON.parse(db.getSetting("learned_topics") || "[]");
  const openLoops = await gatherOpenLoops(true).catch(() => null);
  const briefing = await generateBriefing(gmail, calendar, slackMsgs, carryForward, directives, learnedTopics, openLoops);

  // Passive learning: record what was open vs closed so FRIDAY learns your real
  // response behaviour over time (which channels/people you close fast vs let slide).
  if (openLoops) {
    const s = openLoops.summary;
    logMemory("open_loops", `Open: ${s.slackOpen} slack, ${s.emailOpen} email (${s.emailUnread} unread). Closed since: ${s.slackClosed} slack, ${s.emailClosed} email.`);
    briefing.open_loops = { slack: openLoops.slackOpen, email: openLoops.emailOpen, summary: s };
  }

  // Daily lesson: keep ONE per day stable across regenerations, and remember it so
  // we never repeat a topic. (Costs no extra Claude calls — it's part of the briefing.)
  const today = todayInTz();
  if (db.getSetting("lesson_day") === today && db.getSetting("lesson_json")) {
    briefing.learn = JSON.parse(db.getSetting("lesson_json")); // reuse today's lesson
  } else if (briefing.learn && briefing.learn.title) {
    db.setSetting("lesson_day", today);
    db.setSetting("lesson_json", JSON.stringify(briefing.learn));
    db.setSetting("learned_topics", JSON.stringify([...learnedTopics, briefing.learn.title].slice(-40)));
    // Store the FULL lesson (not just the title) so it's durable in memory + the
    // Google sheet, independent of briefing retention.
    const L = briefing.learn;
    logMemory("lesson", `${L.title} [${L.category || "-"}] — ${L.lesson || ""}${L.example ? ` · Example: ${L.example}` : ""}${L.try_this ? ` · Try: ${L.try_this}` : ""}`);
  }

  db.saveBriefing(date, briefing, "sync");
  db.setSetting("input_signature", sig);
  if (briefing?.summary?.focus_of_day) logMemory("briefing", `${date}: ${briefing.summary.focus_of_day}`);
  return { ok: true, date, focus: briefing?.summary?.focus_of_day || null };
};

// The chat job runs a turn that was queued because Claude was at its limit.
const runChatJob = async ({ messages, briefingContext }) => {
  const reply = await buildAndChat(messages, briefingContext);
  return { reply };
};

queue.register({ generate_briefing: runBriefingJob, chat: runChatJob });

// NON-BLOCKING sync: returns immediately. On a cache miss it parks a generation
// job — the worker runs it now if Claude is free, or after the limit/network
// recovers. The UI's poll swaps in the new briefing when it lands.
app.post("/api/sync", async (req, res) => {
  try {
    const force = !!(req.body?.force || req.query.force);
    const { gmail, calendar, slackMsgs, hasSource } = await gatherInputs(req.body?.slack);
    if (!hasSource) return res.status(400).json({ error: "no sources connected" });

    const date = new Date().toISOString().split("T")[0];
    const sig = inputSignature(gmail, calendar, slackMsgs);
    const existing = db.getBriefing(date);
    const counts = { gmail: gmail.length, calendar: calendar.length, slack: slackMsgs.length };

    // CACHE HIT — nothing changed, no Claude call (the biggest token saver).
    if (!force && existing && db.getSetting("input_signature") === sig) {
      return res.json({ ok: true, cached: true, generating: false, briefing: existing, date, counts, ...queue.status() });
    }

    const { id } = queue.enqueue("generate_briefing", { date, force });
    const st = queue.status();
    res.json({
      ok: true,
      generating: !st.claudeBlocked && !st.offline,
      queued: st.claudeBlocked || st.offline,
      jobId: id, briefing: existing || null, date, counts, ...st,
    });
  } catch (e) {
    console.error("Sync error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Queue / Claude-availability status (drives the UI's "queued / at limit" banner)
app.get("/api/status", (req, res) => res.json(queue.status()));

// Today's real Claude usage — tokens, cost, calls, auto-gen count + the daily cap.
app.get("/api/usage", (req, res) => {
  const u = db.getUsage(todayInTz());
  const cap = (process.env.AUTO_TIMES || "12:00,16:00,20:00").split(",").filter(Boolean).length;
  res.json({ ...u, autoCap: cap });
});

// Open Loops — what's still on you (tagged/emailed, not replied), auto-detected.
app.get("/api/openloops", async (req, res) => {
  try {
    if (!db.getConnection("google") && !db.getConnection("slack")) return res.json({ slackOpen: [], emailOpen: [], summary: {} });
    const data = await gatherOpenLoops(!!req.query.force);
    res.json(data);
  } catch (e) {
    console.error("openloops error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Manual loops — quick capture of things on you with no digital trace (in-person, calls)
app.post("/api/loops/manual", (req, res) => {
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "text required" });
  const id = db.addManualLoop(text);
  _openLoopsCache.at = 0; // reflect immediately
  logMemory("manual_loop", `Captured: ${text}`);
  res.json({ ok: true, id, manual: db.getManualLoops(false) });
});
app.post("/api/loops/manual/:id/done", (req, res) => {
  db.closeManualLoop(Number(req.params.id));
  _openLoopsCache.at = 0;
  res.json({ ok: true, manual: db.getManualLoops(false) });
});
app.delete("/api/loops/manual/:id", (req, res) => {
  db.deleteManualLoop(Number(req.params.id));
  _openLoopsCache.at = 0;
  res.json({ ok: true, manual: db.getManualLoops(false) });
});

// Feedback — product ideas / fixes for FRIDAY, captured via /feedback in chat.
app.get("/api/feedback", (req, res) => res.json({ feedback: db.getFeedback() }));
app.post("/api/feedback", (req, res) => {
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "text required" });
  const id = db.addFeedback(text);
  logMemory("feedback", text); // also mirrored to the Google memory sheet
  res.json({ ok: true, id, feedback: db.getFeedback() });
});
app.post("/api/feedback/:id/done", (req, res) => {
  db.setFeedbackStatus(Number(req.params.id), req.body?.status === "open" ? "open" : "done");
  res.json({ ok: true, feedback: db.getFeedback() });
});
app.delete("/api/feedback/:id", (req, res) => {
  db.deleteFeedback(Number(req.params.id));
  res.json({ ok: true, feedback: db.getFeedback() });
});

// Recent queued jobs (UI shows what's waiting / lets chat pick up its answer)
app.get("/api/outbox", (req, res) => res.json({ jobs: db.getOutbox(30), ...queue.status() }));
app.get("/api/outbox/:id", (req, res) => {
  const job = db.getOutboxJob(Number(req.params.id));
  if (!job) return res.status(404).json({ error: "not found" });
  res.json({ job });
});

// ── Scheduled briefings: regenerate at a few FIXED times a day (not hourly), so
// FRIDAY sips your Claude subscription — leaving you headroom for everything else.
// At each slot it only spends a Claude call if inputs actually changed. Manual
// "sync" in the UI always works and bypasses this schedule. ──
const AUTO_REFRESH_MIN = Number(process.env.AUTO_REFRESH_MINUTES || 20); // how often to CHECK the clock
const AUTO_TIMES = (process.env.AUTO_TIMES || "12:00,16:00,20:00")
  .split(",").map(s => s.trim()).filter(Boolean).sort();

const nowHHMM = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: USER_TZ });
const slotsDoneToday = () =>
  db.getSetting("auto_slots_day") === todayInTz() ? (db.getSetting("auto_slots_done") || "").split(",").filter(Boolean) : [];

// The latest scheduled slot that has already passed today but hasn't been handled.
const dueSlot = () => {
  const t = nowHHMM(), done = slotsDoneToday();
  const passed = AUTO_TIMES.filter(s => t >= s && !done.includes(s));
  return passed.length ? passed[passed.length - 1] : null;
};
const markSlotDone = (slot) => {
  const done = new Set([...slotsDoneToday(), slot]);
  db.setSetting("auto_slots_day", todayInTz());
  db.setSetting("auto_slots_done", [...done].join(","));
};
const noteAutoGen = () => {
  const today = todayInTz();
  const count = db.getSetting("auto_gen_day") === today ? Number(db.getSetting("auto_gen_count") || 0) : 0;
  db.setSetting("auto_gen_day", today);
  db.setSetting("auto_gen_count", String(count + 1));
};

if (AUTO_REFRESH_MIN > 0 && AUTO_TIMES.length) {
  setInterval(async () => {
    try {
      if (!db.getConnection("google")) return;
      const slot = dueSlot();
      if (!slot) return; // not at a scheduled time, or already handled
      const { gmail, calendar, slackMsgs, hasSource } = await gatherInputs(null);
      if (!hasSource) return; // sources not ready — retry next tick (don't burn the slot)
      markSlotDone(slot);     // this slot is now handled for today
      const date = new Date().toISOString().split("T")[0];
      const sig = inputSignature(gmail, calendar, slackMsgs);
      const existing = db.getBriefing(date);
      if (existing && db.getSetting("input_signature") === sig) {
        console.log(`⏰ ${slot} slot: inputs unchanged → no Claude call`);
        return;
      }
      const { deduped } = queue.enqueue("generate_briefing", { date });
      if (!deduped) { noteAutoGen(); console.log(`⏰ ${slot} slot: changes detected → queued briefing`); }
    } catch (e) {
      console.warn("scheduled briefing failed:", e.message);
    }
  }, AUTO_REFRESH_MIN * 60 * 1000);
}

const server = app.listen(PORT, () => {
  console.log(`\n🧠 FRIDAY server running on http://localhost:${PORT}`);
  console.log(`   AI Provider: ${process.env.AI_PROVIDER || "openai"}`);
  console.log(`   Model: ${process.env.CLAUDE_CLI_MODEL || process.env.OPENAI_MODEL || "default"}`);
  const st = queue.status();
  console.log(`   Queue: ${st.pending} pending${st.claudeBlocked ? ` · Claude paused until ${st.blockedUntil}` : ""}\n`);
  queue.start(); // drain any parked jobs + run the retry loop
});
// Briefing generation via Claude can take a while — don't let the socket time out.
server.timeout = 0;
server.requestTimeout = 0;
server.headersTimeout = 0;
