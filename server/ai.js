/**
 * FRIDAY AI Provider
 * Providers (set AI_PROVIDER in .env):
 *   - "claude-cli"  → your LOCAL Claude Code, on your Claude subscription (no API key)
 *   - "anthropic"   → Anthropic API (needs ANTHROPIC_API_KEY)
 *   - "openai"      → OpenAI API (needs OPENAI_API_KEY)
 * Note: semantic-memory embeddings always use OpenAI (Claude has no embeddings API).
 */

require("dotenv").config();
const { spawn } = require("child_process");
const context = require("../src/context.json");

const PROVIDER = process.env.AI_PROVIDER || "openai";

// ── Typed errors so the queue can tell "retry later" from "real failure" ──
// Claude subscription usage limit hit — retry once it resets (resetAt, if known).
class ClaudeLimitError extends Error {
  constructor(message, resetAt = null) { super(message); this.name = "ClaudeLimitError"; this.isClaudeLimit = true; this.resetAt = resetAt; }
}
// No network / Claude unreachable — retry when back online.
class OfflineError extends Error {
  constructor(message) { super(message); this.name = "OfflineError"; this.isOffline = true; }
}

// Classify raw CLI/stderr text into a typed, retryable error (or null if not one).
const classifyClaudeError = (text = "") => {
  const t = text.toLowerCase();
  if (/usage limit|rate limit|too many requests|quota|429|limit reached|reached your|out of (credits|usage)/.test(t)) {
    // Recover a reset time if present. Claude's limit message is often of the form
    // "Claude usage limit reached|1749200400" — i.e. a trailing epoch (s or ms).
    let resetAt = null;
    const epoch = t.match(/(\d{10,13})/);
    if (epoch) { const n = Number(epoch[1]); resetAt = new Date(epoch[1].length > 10 ? n : n * 1000).toISOString(); }
    return new ClaudeLimitError("Claude usage limit reached" + (resetAt ? ` (resets ${resetAt})` : ""), resetAt);
  }
  if (/enotfound|eai_again|econnrefused|etimedout|network|offline|getaddrinfo|connect timeout|unable to connect|\bdns\b/.test(t)) {
    return new OfflineError("Claude/network unreachable");
  }
  return null;
};

// ── OpenAI ────────────────────────────────────────────────────
const getOpenAIResponse = async (messages, systemPrompt, maxTokens = 2000) => {
  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
  });
  return res.choices[0].message.content;
};

// ── Anthropic ─────────────────────────────────────────────────
const getAnthropicResponse = async (messages, systemPrompt, maxTokens = 2000) => {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });
  return res.content.filter(b => b.type === "text").map(b => b.text).join("");
};

// Optional hook: index.js sets this to record real per-call token usage/cost.
let usageSink = null;
const setUsageSink = (fn) => { usageSink = fn; };

// ── Local Claude Code (subscription, no API key) ──────────────
const getClaudeCliResponse = (messages, systemPrompt) =>
  new Promise((resolve, reject) => {
    const bin = process.env.CLAUDE_CLI_PATH || "claude";
    // --strict-mcp-config skips loading all MCP connectors (huge startup saving).
    // --output-format json so we get back exact token usage + cost for tracking.
    const args = ["-p", "--output-format", "json", "--strict-mcp-config"];
    if (process.env.CLAUDE_CLI_MODEL) args.push("--model", process.env.CLAUDE_CLI_MODEL);

    // Use the Claude SUBSCRIPTION login, not an API key. Any ANTHROPIC_API_KEY in
    // env would force Claude into API mode (and ours is a placeholder) — strip it.
    const childEnv = { ...process.env };
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.ANTHROPIC_AUTH_TOKEN;

    // Run in a neutral dir so it doesn't load FRIDAY's project context/CLAUDE.md.
    let child;
    try {
      child = spawn(bin, args, { env: childEnv, cwd: require("os").tmpdir() });
    } catch (e) { return reject(new OfflineError("claude cli not runnable: " + e.message)); }
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new OfflineError("claude cli timed out")); }, 420000);
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("error", e => { clearTimeout(timer); reject(new OfflineError("claude cli not runnable: " + e.message)); });
    child.on("close", code => {
      clearTimeout(timer);
      let parsed = null;
      try { parsed = JSON.parse(out); } catch { /* not json (maybe an error on stderr) */ }

      // Record real usage whenever the CLI reported it (even on error turns).
      if (parsed && parsed.usage && usageSink) {
        const u = parsed.usage;
        try {
          usageSink({
            input: u.input_tokens || 0,
            output: u.output_tokens || 0,
            cacheCreate: u.cache_creation_input_tokens || 0,
            cacheRead: u.cache_read_input_tokens || 0,
            cost: parsed.total_cost_usd || 0,
          });
        } catch { /* tracking must never break generation */ }
      }

      const blob = `${err}\n${out}\n${parsed?.result || ""}`;
      if (code !== 0 || (parsed && parsed.is_error)) {
        const typed = classifyClaudeError(blob);
        if (typed) return reject(typed);
        return reject(new Error(`claude cli exited ${code}: ${(err || out || "no output").slice(0, 400)}`));
      }
      const text = parsed ? String(parsed.result ?? "") : out;
      // Some limit conditions come back as a short result with exit 0 — catch those.
      const typed = classifyClaudeError(text);
      if (typed && typed.isClaudeLimit && text.trim().length < 400) return reject(typed);
      resolve(text.trim());
    });

    const full = `${systemPrompt}\n\n=== CONVERSATION ===\n${messages.map(m => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`).join("\n\n")}`;
    child.stdin.write(full);
    child.stdin.end();
  });

// ── Unified call ──────────────────────────────────────────────
const chat = async (messages, extraContext = "", maxTokens = 2000) => {
  const systemPrompt = buildSystemPrompt(extraContext);
  if (PROVIDER === "claude-cli") return getClaudeCliResponse(messages, systemPrompt);
  if (PROVIDER === "anthropic")  return getAnthropicResponse(messages, systemPrompt, maxTokens);
  return getOpenAIResponse(messages, systemPrompt, maxTokens);
};

// ── System prompt builder ─────────────────────────────────────
const buildSystemPrompt = (extraContext = "") => {
  const now = new Date().toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: context.user.timezone,
  });
  const time = new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: context.user.timezone,
  });

  return `${context.ai_instructions}

USER PROFILE:
Name: ${context.user.name}
Role: ${context.user.designation} at ${context.user.org}
Timezone: ${context.user.timezone}
Work hours: ${context.user.work_hours.start} – ${context.user.work_hours.end} IST
Today: ${now} · ${time} IST

LEADERSHIP (report to / escalate to):
${context.leadership.map(l => `- ${l.name} (${l.role}): ${l.interaction}`).join("\n")}

TEAM (direct reports / delegates):
${context.team.map(t => `- ${t.name} (${t.role}): owns ${t.owns.join(", ")}`).join("\n")}

PEERS:
${context.peers.map(p => `- ${p.name} (${p.role})`).join("\n")}

CURRENT PRIORITIES:
${context.current_priorities.map(p =>
  `- ${p.initiative} [${p.status}] ${p.started} → ${p.ends}: ${p.description}`
).join("\n")}

${extraContext ? `ADDITIONAL CONTEXT:\n${extraContext}` : ""}

SLASH COMMANDS you understand:
/sync, /slackunread, /emailtriage, /standup, /focus, /blockers, /delegate, /eod, /week, /draft

RESPONSE RULES:
- Be concise, direct, executive-level
- Surface insights, not raw data
- Always suggest who to delegate to when relevant
- Use priority levels: P1 (critical today), P2 (important this week), P3 (normal), P4 (low)`;
};

// ── Token optimization ────────────────────────────────────────
// The raw connector payloads are dumped into the prompt verbatim today. Re-encoding
// them as terse lines (no repeated JSON keys/braces/quotes) and capping count +
// length cuts the input tokens roughly in half with no loss of useful signal.
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };

const compactGmail = (mail = [], max = 30) => {
  // Addressed-to-me first (those can need a reply); tag each so the model can tell
  // a real ask from FYI. Cc-only is low-signal noise unless it's a clear escalation.
  // _ref keeps the ORIGINAL index so the model can point a card back at the exact
  // email; we map that ref → real gmail_url server-side after generation.
  const ranked = mail.map((m, i) => ({ ...m, _ref: `g${i}` }))
    .sort((a, b) => (b.addressedToMe ? 1 : 0) - (a.addressedToMe ? 1 : 0));
  return (ranked.slice(0, max).map(m => {
    const tag = m.addressedToMe ? "[TO-ME]" : m.ccOnly ? "[cc/fyi]" : "";
    const lbl = m.labels?.length ? ` {${m.labels.join(", ")}}` : "";
    return `- [${m._ref}] ${tag} ${clip(m.from, 50)} | ${clip(m.subject, 90)} | ${clip(m.snippet, 140)}${lbl}`;
  }).join("\n")) + (mail.length > max ? `\n  (+${mail.length - max} more)` : "") || "  (none)";
};

const compactCalendar = (cal = []) =>
  (cal.map(e =>
    `- ${clip(e.start, 16)} ${clip(e.title, 70)}${(e.attendees || []).length ? ` (${(e.attendees || []).slice(0, 4).map(a => String(a).split("@")[0]).join(", ")}${e.attendees.length > 4 ? "…" : ""})` : ""}`
  ).join("\n")) || "  (none)";

const compactSlack = (slack = [], max = 25) =>
  (slack.slice(0, max).map((m, i) =>
    `- [s${i}] #${clip(m.channel, 30)} @${clip(m.user, 24)}: ${clip(m.text, 160)}`
  ).join("\n")) + (slack.length > max ? `\n  (+${slack.length - max} more)` : "") || "  (none)";

const compactTasks = (tasks = []) =>
  (tasks.map(t => `- [${t.priority || "P3"}] ${clip(t.task, 100)} (${t.status || "Not Started"})`).join("\n")) || "  (none)";

// ── Briefing generator ────────────────────────────────────────
const compactOpenLoops = (loops) => {
  if (!loops) return "  (not available)";
  const s = (loops.slackOpen || []).map(m => `- SLACK #${m.channel} · ${m.ageHours}h · @${m.user}: ${clip(m.text, 130)}`).join("\n");
  const e = (loops.emailOpen || []).map(t => `- EMAIL ${t.unread ? "(unread)" : "(read)"} from ${clip((t.from || "").replace(/<.*>/, ""), 30)}: ${clip(t.subject, 80)}`).join("\n");
  const man = (loops.manual || []).map(m => `- COMMITTED (he noted this himself, in-person/ad-hoc — treat as a firm action item): ${clip(m.text, 130)}`).join("\n");
  return `${man ? man + "\n" : ""}${s || "  (no open Slack tags)"}\n${e || "  (no open emails)"}`;
};

const generateBriefing = async (gmailData, calendarData, slackData, carryForwardTasks = [], directives = [], learnedTopics = [], openLoops = null) => {
  const tz = context.user.timezone;
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: tz });
  const wh = context.user.work_hours || { start: "12:00", end: "21:00" };
  const recurring = (context.recurring_meetings || [])
    .map(m => `   - ${m.time} ${m.name}${m.with ? ` (with ${m.with})` : ""}${m.attendees ? ` (${m.attendees.join(", ")})` : ""}`)
    .join("\n") || "   - (none on record)";

  const prompt = `You are FRIDAY, ${context.user.name}'s Chief of Staff (${context.user.designation}, ${context.user.org}). Produce his COMPLETE daily briefing as a single JSON object for ${today}.

Be SPECIFIC, DETAILED and EXECUTIVE-GRADE. Use the real names, programs, batch IDs and concrete next steps found in the data — never write generic filler. Every line should read like it was written by a sharp chief of staff who knows his world inside out.

THINK LIKE A CHIEF OF STAFF, NOT A LIST-MAKER. Your single most valuable job is to surface what is EASY TO MISS — the quiet risks, the things slipping through the cracks, the second-order consequences, the small-looking items that will blow up if ignored, the threads that have gone silent. Read between the lines and CONNECT THE DOTS ACROSS SOURCES: e.g., a refund request + a consumer-court mention + a leadership "hold" together = a LEGAL ESCALATION, not three separate notes; a batch missing its LMS Batch ID + an upcoming session for that batch = an imminent student-impact incident. Prioritise what is IMPORTANT BUT QUIET over what is merely loud. For EACH standing priority, proactively ask "is anything about this being neglected right now?" and if so, surface it — even if the data only hints at it. The user should read this and think "I would have missed that."

CHANNEL WEIGHTING (important): His real work happens on SLACK and IN-PERSON. Treat SLACK mentions, threads and unanswered tags as the PRIMARY, highest-signal source — lead the briefing, standup and action items with them. EMAIL is mainly an official record and EXTERNAL channel; treat it as lower-signal and only elevate an email if it is an external escalation, a formal/legal notice, or an official decision needing his sign-off. Do not pad the briefing with routine email noise.

${directives.length ? `== STANDING PRIORITIES (weight heavily across the whole briefing) ==\n${directives.map((d, i) => `${i + 1}. ${d}`).join("\n")}\n` : ""}
== INPUT DATA ==
GMAIL (received + sent). [TO-ME] = he is in the To line (a real ask — may need his reply); [cc/fyi] = he is only Cc'd (FYI/awareness, NOT a reply obligation — IGNORE unless it is a clear escalation, a leadership/founder ask, or money/student at risk). {curly braces} = his OWN Gmail triage labels — trust them: a "Base Secured" (done) label means resolved (do NOT surface it), an action label (e.g. Rapid Response, Action Pending, Revert Pending, followup, Closure Pending, Tactical Check) means HE flagged it to act on (treat as a real action), "Command Await" = waiting on someone else, "Spectate" = FYI only:
${compactGmail(gmailData)}
CALENDAR (today's events):
${compactCalendar(calendarData)}
SLACK (messages where he was tagged/asked — may await his reply):
${compactSlack(slackData)}
OPEN LOOPS (auto-detected — tagged/emailed and he has NOT replied yet; these are the highest-signal "still on him" items):
${compactOpenLoops(openLoops)}
CARRY-FORWARD (incomplete tasks from yesterday):
${compactTasks(carryForwardTasks)}

== HOW TO BUILD EACH SECTION (follow precisely) ==
1. briefing.critical_updates — 3 to 5 items that genuinely need his attention today, drawn PRIMARILY from Slack and Gmail signals (his real channels) plus the standing priorities. Each: a specific title and a detail of 1-2 full sentences with the real context (who, which program/batch, why it matters, what's at stake). source = "slack" | "gmail" | "calendar" | "manual" (where it came from). ref (REQUIRED, do not omit) = the bracket tag printed at the very start of the source line this item is based on. Every GMAIL and SLACK line below is prefixed with its tag like "[g3]" or "[s2]" — copy that tag's inner value VERBATIM into ref (e.g. ref:"g3"). Set ref:"" ONLY when the item comes from a calendar event, a manual note, or a standing priority (nothing to link). This builds the deep-link to the original message; an item with source gmail/slack and an empty ref is a bug. priority = "P1" (must act today — blocking someone, a deadline, a leadership/founder ask, money or a student at risk) | "P2" (important, act soon) | "P3" (worth knowing, not urgent). urgency = "high" | "medium" | "low" (mirror the priority). RANK these so the most important is first.
2. briefing.decisions_needed — decisions only HE can make. Give title, context (the tradeoff / why it's stuck), and "from" (who's asking).
3. briefing.stakeholder_followups — people waiting on him: person, channel, waiting_since, topic. Build this PRIMARILY from the OPEN LOOPS list (those are confirmed unanswered). Lead with the Slack open loops; include only the emails that genuinely need a personal reply. Drop anything that's just an FYI/notification.
4. standup.leadership — what he reports UP to Keshav/Aman. yesterday = concrete things shipped; today = what he is personally driving; blockers = what's stuck + who he needs. 3 specific bullets each (not one-liners).
5. standup.team — yesterday = what his team delivered; today = what they're working on; delegate = specific things to hand to NAMED teammates (e.g., "Rajesh: assign LMS Batch IDs for the 12 cohorts").
6. action_items — 6 to 9 concrete, actionable tasks from the data, carry-forward and priorities. Each: id (short slug), task (specific), owner ("Me" or a named teammate), due, status ("Not Started"), priority (P1 = critical+today, P2 = important this week, P3 = normal, P4 = low), priority_reason (one line WHY), source ("gmail"|"slack"|"calendar"|"manual"), type ("action"|"decision"|"delegate"|"followup"|"people").
7. schedule — DESIGN HIS FULL DAY from ${wh.start} to ${wh.end} IST. THIS IS THE CENTREPIECE:
   - Anchor every real calendar meeting at its actual time.
   - Anchor his recurring meetings:\n${recurring}
   - Time-block the action_items into the gaps: P1 deep-work in the early afternoon, calls & follow-ups mid-afternoon, dedicated email/Slack processing blocks, a short buffer.
   - Open with a planning block at ${wh.start} and close with an EOD wrap-up + next-day prep near ${wh.end}.
   - Cover the WHOLE window with NO large empty gaps. Each block: time ("HH:MM" 24h), block (specific title tied to a real meeting or task), type ("deep_work"|"meeting"|"followup"|"comms"|"buffer"|"strategic"), notes (what to actually do).
8. summary — focus_of_day (one punchy sentence naming the single most important outcome today), top3 (the three things that MUST happen), risk_flag (biggest risk today, or "").
9. learn — teach him ONE genuinely useful, NEW, often-under-the-radar thing that helps a senior operations leader (~10 yrs experience) grow professionally AND personally. ROTATE widely across domains day to day — do NOT default to spreadsheets every time. category = "sheets" | "product" | "management" | "finance" | "strategy" | "communication" | "automation" | "growth". Pick rare-but-high-leverage over basics. lesson = 1-2 sentences on what it is and why it matters. example = a tiny concrete example tied to HIS ops/leadership world (a formula, a framework applied to a real situation, a number). try_this = one specific thing to try today. DO NOT repeat any of these already-taught topics: ${learnedTopics.length ? learnedTopics.join("; ") : "(none yet)"}.

Return ONLY valid JSON, no markdown fences, exactly this shape:
{
  "briefing": { "critical_updates": [{"id":"cu-1","title":"…","detail":"…","source":"gmail","priority":"P1","urgency":"high","ref":"g3"}], "decisions_needed": [{"title","context","from"}], "stakeholder_followups": [{"person","channel","waiting_since","topic","slack_url"}] },
  "standup": { "leadership": {"yesterday":[],"today":[],"blockers":[]}, "team": {"yesterday":[],"today":[],"delegate":[]} },
  "action_items": [{"id","task","owner","due","status","priority","priority_reason","source","type"}],
  "schedule": [{"time","block","type","notes"}],
  "summary": {"focus_of_day","top3":[],"risk_flag"},
  "learn": {"title","category","lesson","example","try_this"}
}`;

  const raw = await chat([{ role: "user", content: prompt }], "", 6000);
  const clean = raw.replace(/```json|```/g, "").trim();
  // Be robust to any preamble/postamble: parse the outermost JSON object
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  const jsonStr = start >= 0 && end > start ? clean.slice(start, end + 1) : clean;
  const parsed = JSON.parse(jsonStr);

  // Deep-link each critical_update back to its real source message via the ref the
  // model echoed. Deterministic — the URL comes from our data, never invented by Claude.
  try {
    const refMap = {};
    (slackData || []).forEach((m, i) => { if (m.slack_url) refMap[`s${i}`] = { slack_url: m.slack_url }; });
    (gmailData || []).forEach((m, i) => { if (m.gmail_url) refMap[`g${i}`] = { gmail_url: m.gmail_url }; });
    for (const u of (parsed?.briefing?.critical_updates || [])) {
      const link = u.ref && refMap[u.ref];
      if (link) Object.assign(u, link);
    }
  } catch { /* non-fatal — links are a nicety, never block the briefing */ }

  return parsed;
};

module.exports = { chat, generateBriefing, buildSystemPrompt, ClaudeLimitError, OfflineError, classifyClaudeError, setUsageSink };
