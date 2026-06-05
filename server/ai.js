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

// ── Local Claude Code (subscription, no API key) ──────────────
const getClaudeCliResponse = (messages, systemPrompt) =>
  new Promise((resolve, reject) => {
    const bin = process.env.CLAUDE_CLI_PATH || "claude";
    // --strict-mcp-config skips loading all MCP connectors (huge startup saving).
    const args = ["-p", "--output-format", "text", "--strict-mcp-config"];
    if (process.env.CLAUDE_CLI_MODEL) args.push("--model", process.env.CLAUDE_CLI_MODEL);

    // Use the Claude SUBSCRIPTION login, not an API key. Any ANTHROPIC_API_KEY in
    // env would force Claude into API mode (and ours is a placeholder) — strip it.
    const childEnv = { ...process.env };
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.ANTHROPIC_AUTH_TOKEN;

    // Run in a neutral dir so it doesn't load FRIDAY's project context/CLAUDE.md.
    const child = spawn(bin, args, { env: childEnv, cwd: require("os").tmpdir() });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("claude cli timed out")); }, 420000);
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("error", e => { clearTimeout(timer); reject(new Error("claude cli not runnable: " + e.message)); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude cli exited ${code}: ${(err || out || "no output").slice(0, 400)}`));
      resolve(out.trim());
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

// ── Briefing generator ────────────────────────────────────────
const generateBriefing = async (gmailData, calendarData, slackData, carryForwardTasks = [], directives = []) => {
  const tz = context.user.timezone;
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: tz });
  const wh = context.user.work_hours || { start: "12:00", end: "21:00" };
  const recurring = (context.recurring_meetings || [])
    .map(m => `   - ${m.time} ${m.name}${m.with ? ` (with ${m.with})` : ""}${m.attendees ? ` (${m.attendees.join(", ")})` : ""}`)
    .join("\n") || "   - (none on record)";

  const prompt = `You are FRIDAY, ${context.user.name}'s Chief of Staff (${context.user.designation}, ${context.user.org}). Produce his COMPLETE daily briefing as a single JSON object for ${today}.

Be SPECIFIC, DETAILED and EXECUTIVE-GRADE. Use the real names, programs, batch IDs and concrete next steps found in the data — never write generic filler. Every line should read like it was written by a sharp chief of staff who knows his world inside out.

THINK LIKE A CHIEF OF STAFF, NOT A LIST-MAKER. Your single most valuable job is to surface what is EASY TO MISS — the quiet risks, the things slipping through the cracks, the second-order consequences, the small-looking items that will blow up if ignored, the threads that have gone silent. Read between the lines and CONNECT THE DOTS ACROSS SOURCES: e.g., a refund request + a consumer-court mention + a leadership "hold" together = a LEGAL ESCALATION, not three separate notes; a batch missing its LMS Batch ID + an upcoming session for that batch = an imminent student-impact incident. Prioritise what is IMPORTANT BUT QUIET over what is merely loud. For EACH standing priority, proactively ask "is anything about this being neglected right now?" and if so, surface it — even if the data only hints at it. The user should read this and think "I would have missed that."

${directives.length ? `== STANDING PRIORITIES (weight heavily across the whole briefing) ==\n${directives.map((d, i) => `${i + 1}. ${d}`).join("\n")}\n` : ""}
== INPUT DATA ==
GMAIL (received + sent): ${JSON.stringify(gmailData)}
CALENDAR (today's events): ${JSON.stringify(calendarData)}
SLACK (messages where he was tagged/asked — may await his reply): ${JSON.stringify(slackData)}
CARRY-FORWARD (incomplete tasks from yesterday): ${JSON.stringify(carryForwardTasks)}

== HOW TO BUILD EACH SECTION (follow precisely) ==
1. briefing.critical_updates — 3 to 5 items that genuinely need his attention today. Each: a specific title and a detail of 1-2 full sentences with the real context (who, which program/batch, why it matters, what's at stake). urgency = "high" | "medium" | "low". Draw from email/slack signals AND the standing priorities.
2. briefing.decisions_needed — decisions only HE can make. Give title, context (the tradeoff / why it's stuck), and "from" (who's asking).
3. briefing.stakeholder_followups — people waiting on him: person, channel, waiting_since, topic. Include every unanswered Slack tag that needs his reply.
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

Return ONLY valid JSON, no markdown fences, exactly this shape:
{
  "briefing": { "critical_updates": [{"id","title","detail","source","urgency","slack_url"}], "decisions_needed": [{"title","context","from"}], "stakeholder_followups": [{"person","channel","waiting_since","topic","slack_url"}] },
  "standup": { "leadership": {"yesterday":[],"today":[],"blockers":[]}, "team": {"yesterday":[],"today":[],"delegate":[]} },
  "action_items": [{"id","task","owner","due","status","priority","priority_reason","source","type"}],
  "schedule": [{"time","block","type","notes"}],
  "summary": {"focus_of_day","top3":[],"risk_flag"}
}`;

  const raw = await chat([{ role: "user", content: prompt }], "", 6000);
  const clean = raw.replace(/```json|```/g, "").trim();
  // Be robust to any preamble/postamble: parse the outermost JSON object
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  const jsonStr = start >= 0 && end > start ? clean.slice(start, end + 1) : clean;
  return JSON.parse(jsonStr);
};

module.exports = { chat, generateBriefing, buildSystemPrompt };
