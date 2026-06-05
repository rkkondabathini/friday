/**
 * FRIDAY API Client
 * All frontend → backend calls go through here
 */

const BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

const req = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
};

// ── Briefing ───────────────────────────────────────────────────
export const getBriefing = (date) =>
  req("GET", `/api/briefing${date ? `?date=${date}` : ""}`);

export const getBriefingHistory = () =>
  req("GET", "/api/briefing/history");

export const saveBriefing = (briefing, date, source) =>
  req("POST", "/api/briefing", { briefing, date, source });

// ── Tasks ──────────────────────────────────────────────────────
export const updateTaskStatus = (id, status) =>
  req("PATCH", `/api/tasks/${id}/status`, { status });

export const addCustomTask = (task) =>
  req("POST", "/api/tasks/custom", task);

export const getCustomTasks = () =>
  req("GET", "/api/tasks/custom");

export const deleteCustomTask = (id) =>
  req("DELETE", `/api/tasks/custom/${id}`);

// ── Chat ───────────────────────────────────────────────────────
export const sendChat = (messages, briefingContext) =>
  req("POST", "/api/chat", { messages, briefingContext });

// ── Memory ─────────────────────────────────────────────────────
export const addMemory = (type, content) =>
  req("POST", "/api/memory", { type, content });

// ── Patterns ───────────────────────────────────────────────────
export const getPatterns = () =>
  req("GET", "/api/patterns");

// ── Connections / OAuth ────────────────────────────────────────
export const getConnections = () =>
  req("GET", "/api/connections");

// Send the browser to the provider's sign-in page
export const connect = (provider) => {
  window.location.href = `${BASE}/api/auth/${provider}`;
};

export const disconnect = (provider) =>
  req("DELETE", `/api/connections/${provider}`);

// Pull from connected sources and generate a fresh briefing
export const sync = () =>
  req("POST", "/api/sync");

// ── Memory sheet ───────────────────────────────────────────────
export const getMemorySheet = () =>
  req("GET", "/api/memory/sheet");

export const backfillMemory = () =>
  req("POST", "/api/memory/backfill");

// ── Semantic memory (RAG) ──────────────────────────────────────
export const getMemoryStats = () =>
  req("GET", "/api/memory/stats");

export const getProfile = () =>
  req("GET", "/api/memory/profile");

// ── Directives (standing priorities) ───────────────────────────
export const getDirectives = () =>
  req("GET", "/api/directives");

export const addDirective = (text) =>
  req("POST", "/api/directives", { text });

export const deleteDirective = (id) =>
  req("DELETE", `/api/directives/${id}`);
