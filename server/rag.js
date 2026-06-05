/**
 * FRIDAY RAG — ingest items into semantic memory and recall the most
 * relevant ones for a query. Brute-force cosine over the local vector store
 * (fast and simple for tens of thousands of items; no external vector DB).
 */

const db = require("./db");
const { embed, embedBatch, cosine } = require("./embeddings");

// Turn a raw source item into the text we embed + store
const renderItem = (it) => {
  if (it.text && it.title == null) return it.text;
  return [it.title, it.text].filter(Boolean).join(" — ");
};

/**
 * Ingest items into memory. Each item: { source, ext_id, date, title, text }.
 * Skips items already stored (by source+ext_id) unless force=true.
 * Returns { added, skipped }.
 */
const ingest = async (items, { force = false } = {}) => {
  const fresh = force ? items : items.filter((it) => !db.hasVector(it.source, it.ext_id));
  if (!fresh.length) return { added: 0, skipped: items.length };

  const texts = fresh.map(renderItem);
  const vectors = await embedBatch(texts);
  fresh.forEach((it, i) => {
    db.addVector({
      source: it.source,
      ext_id: it.ext_id,
      date: it.date,
      title: it.title || null,
      text: renderItem(it),
      embedding: vectors[i],
    });
  });
  return { added: fresh.length, skipped: items.length - fresh.length };
};

/**
 * Recall the top-k most relevant memory items for a query string.
 * Returns [{ source, date, title, text, score }] sorted by score desc.
 */
const recall = async (query, k = 6) => {
  if (!query || !query.trim()) return [];
  const all = db.allVectors();
  if (!all.length) return [];
  const q = await embed(query);
  return all
    .map((v) => ({ source: v.source, date: v.date, title: v.title, text: v.text, score: cosine(q, v.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
};

// Format recalled items for injection into an AI prompt
const formatRecall = (items) =>
  items
    .map((r) => `- [${r.source}${r.date ? " · " + r.date.slice(0, 10) : ""}] ${r.text}`.slice(0, 400))
    .join("\n");

module.exports = { ingest, recall, formatRecall };
