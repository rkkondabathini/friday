/**
 * FRIDAY SQLite Database
 * Tables: briefings, tasks, task_overrides, memory
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "../friday.db");
const db = new Database(DB_PATH);

// Enable WAL for better performance
db.pragma("journal_mode = WAL");

// ── Schema ─────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS briefings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    source TEXT DEFAULT 'manual'
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    briefing_date TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_overrides (
    task_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_tasks (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    occurrences INTEGER DEFAULT 1,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS connections (
    provider TEXT PRIMARY KEY,
    tokens TEXT NOT NULL,
    account TEXT,
    connected_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS directives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    tag TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory_vectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    ext_id TEXT NOT NULL,
    date TEXT,
    title TEXT,
    text TEXT NOT NULL,
    embedding TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(source, ext_id)
  );
`);

// ── Briefings ──────────────────────────────────────────────────
const saveBriefing = (date, data, source = "manual") => {
  const stmt = db.prepare(`
    INSERT INTO briefings (date, data, saved_at, source)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      data = excluded.data,
      saved_at = excluded.saved_at,
      source = excluded.source
  `);
  stmt.run(date, JSON.stringify(data), new Date().toISOString(), source);

  // Also save individual tasks from this briefing
  const tasks = data.action_items || [];
  const taskStmt = db.prepare(`
    INSERT INTO tasks (id, briefing_date, data, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data
  `);
  tasks.forEach(t => taskStmt.run(t.id, date, JSON.stringify(t), new Date().toISOString()));
};

const getBriefing = (date) => {
  const row = db.prepare("SELECT * FROM briefings WHERE date = ?").get(date);
  if (!row) return null;
  return { ...JSON.parse(row.data), savedAt: row.saved_at, source: row.source };
};

const getLatestBriefing = () => {
  const row = db.prepare("SELECT * FROM briefings ORDER BY date DESC LIMIT 1").get();
  if (!row) return null;
  return { ...JSON.parse(row.data), savedAt: row.saved_at, date: row.date };
};

const getBriefingHistory = (limit = 7) => {
  const rows = db.prepare("SELECT date, saved_at, source FROM briefings ORDER BY date DESC LIMIT ?").all(limit);
  return rows;
};

// ── Task overrides ─────────────────────────────────────────────
const setTaskStatus = (taskId, status) => {
  db.prepare(`
    INSERT INTO task_overrides (task_id, status, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
  `).run(taskId, status, new Date().toISOString());
};

const getTaskOverrides = () => {
  const rows = db.prepare("SELECT task_id, status FROM task_overrides").all();
  return Object.fromEntries(rows.map(r => [r.task_id, r.status]));
};

// ── Custom tasks ───────────────────────────────────────────────
const saveCustomTask = (task) => {
  db.prepare(`
    INSERT INTO custom_tasks (id, data, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data
  `).run(task.id, JSON.stringify(task), new Date().toISOString());
};

const getCustomTasks = () => {
  const rows = db.prepare("SELECT data FROM custom_tasks ORDER BY created_at DESC").all();
  return rows.map(r => JSON.parse(r.data));
};

const deleteCustomTask = (id) => {
  db.prepare("DELETE FROM custom_tasks WHERE id = ?").run(id);
};

// ── Memory ─────────────────────────────────────────────────────
const addMemory = (type, content) => {
  db.prepare(`
    INSERT INTO memory (type, content, date, created_at)
    VALUES (?, ?, ?, ?)
  `).run(type, content, new Date().toISOString().split("T")[0], new Date().toISOString());
};

const getRecentMemory = (limit = 20) => {
  return db.prepare("SELECT * FROM memory ORDER BY created_at DESC LIMIT ?").all(limit);
};

// ── Carry-forward (incomplete tasks from yesterday) ────────────
const getCarryForwardTasks = () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDate = yesterday.toISOString().split("T")[0];

  const row = db.prepare("SELECT data FROM briefings WHERE date = ?").get(yDate);
  if (!row) return [];

  const briefing = JSON.parse(row.data);
  const overrides = getTaskOverrides();
  const tasks = briefing.action_items || [];

  return tasks
    .map(t => ({ ...t, status: overrides[t.id] || t.status }))
    .filter(t => t.status !== "Completed");
};

// ── Pattern tracking ───────────────────────────────────────────
const trackPattern = (pattern) => {
  const existing = db.prepare("SELECT * FROM patterns WHERE pattern = ?").get(pattern);
  if (existing) {
    db.prepare("UPDATE patterns SET occurrences = occurrences + 1, last_seen = ? WHERE pattern = ?")
      .run(new Date().toISOString().split("T")[0], pattern);
  } else {
    db.prepare("INSERT INTO patterns (pattern, first_seen, last_seen) VALUES (?, ?, ?)")
      .run(pattern, new Date().toISOString().split("T")[0], new Date().toISOString().split("T")[0]);
  }
};

const getTopPatterns = (limit = 10) => {
  return db.prepare("SELECT * FROM patterns ORDER BY occurrences DESC LIMIT ?").all(limit);
};

// ── OAuth connections ──────────────────────────────────────────
const saveConnection = (provider, tokens, account = null) => {
  db.prepare(`
    INSERT INTO connections (provider, tokens, account, connected_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      tokens = excluded.tokens,
      account = COALESCE(excluded.account, connections.account),
      connected_at = excluded.connected_at
  `).run(provider, JSON.stringify(tokens), account, new Date().toISOString());
};

const getConnection = (provider) => {
  const row = db.prepare("SELECT * FROM connections WHERE provider = ?").get(provider);
  if (!row) return null;
  return { provider: row.provider, tokens: JSON.parse(row.tokens), account: row.account, connectedAt: row.connected_at };
};

const getConnections = () => {
  const rows = db.prepare("SELECT provider, account, connected_at FROM connections").all();
  return rows.map(r => ({ provider: r.provider, account: r.account, connectedAt: r.connected_at }));
};

const deleteConnection = (provider) => {
  db.prepare("DELETE FROM connections WHERE provider = ?").run(provider);
};

// ── Settings (key/value) ───────────────────────────────────────
const getSetting = (key) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
};

const setSetting = (key, value) => {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
};

// ── Directives (standing priorities / instructions from the user) ──
const addDirective = (text, tag = null) => {
  const info = db.prepare("INSERT INTO directives (text, tag, created_at) VALUES (?, ?, ?)")
    .run(text, tag, new Date().toISOString());
  return info.lastInsertRowid;
};

const getDirectives = () =>
  db.prepare("SELECT id, text, tag, created_at FROM directives ORDER BY id ASC").all();

const deleteDirective = (id) =>
  db.prepare("DELETE FROM directives WHERE id = ?").run(id);

// ── Memory vectors (semantic memory / RAG) ─────────────────────
const hasVector = (source, extId) =>
  !!db.prepare("SELECT 1 FROM memory_vectors WHERE source = ? AND ext_id = ?").get(source, extId);

const addVector = ({ source, ext_id, date, title, text, embedding }) => {
  db.prepare(`
    INSERT INTO memory_vectors (source, ext_id, date, title, text, embedding, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, ext_id) DO UPDATE SET
      date = excluded.date, title = excluded.title,
      text = excluded.text, embedding = excluded.embedding
  `).run(source, ext_id, date || null, title || null, text, JSON.stringify(embedding), new Date().toISOString());
};

// All vectors with embeddings parsed (for brute-force cosine search)
const allVectors = () => {
  const rows = db.prepare("SELECT id, source, ext_id, date, title, text, embedding FROM memory_vectors").all();
  return rows.map(r => ({ ...r, embedding: JSON.parse(r.embedding) }));
};

const countVectors = () => {
  const total = db.prepare("SELECT COUNT(*) n FROM memory_vectors").get().n;
  const bySource = db.prepare("SELECT source, COUNT(*) n FROM memory_vectors GROUP BY source").all();
  return { total, bySource: Object.fromEntries(bySource.map(s => [s.source, s.n])) };
};

// Lightweight sample of recent items' text (for profile synthesis)
const sampleVectorText = (limit = 120) =>
  db.prepare("SELECT source, date, title, text FROM memory_vectors ORDER BY date DESC LIMIT ?").all(limit);

module.exports = {
  saveBriefing, getBriefing, getLatestBriefing, getBriefingHistory,
  setTaskStatus, getTaskOverrides,
  saveCustomTask, getCustomTasks, deleteCustomTask,
  addMemory, getRecentMemory,
  getCarryForwardTasks,
  trackPattern, getTopPatterns,
  saveConnection, getConnection, getConnections, deleteConnection,
  getSetting, setSetting,
  addDirective, getDirectives, deleteDirective,
  hasVector, addVector, allVectors, countVectors, sampleVectorText,
};
