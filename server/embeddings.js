/**
 * FRIDAY embeddings — turns text into vectors for semantic memory (RAG).
 * Always uses OpenAI embeddings (Anthropic has no embeddings API), regardless
 * of AI_PROVIDER. Requires OPENAI_API_KEY.
 */

require("dotenv").config();

const MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

let _client = null;
const client = () => {
  if (!_client) {
    const OpenAI = require("openai");
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
};

// Embed a single string → number[]
const embed = async (text) => {
  const res = await client().embeddings.create({ model: MODEL, input: text.slice(0, 8000) });
  return res.data[0].embedding;
};

// Embed many strings in batches → number[][] (order preserved)
const embedBatch = async (texts, batchSize = 96) => {
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const chunk = texts.slice(i, i + batchSize).map((t) => (t || "").slice(0, 8000) || " ");
    const res = await client().embeddings.create({ model: MODEL, input: chunk });
    // API returns items with .index; sort to be safe
    res.data.sort((a, b) => a.index - b.index).forEach((d) => out.push(d.embedding));
  }
  return out;
};

// Cosine similarity between two equal-length vectors
const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

module.exports = { embed, embedBatch, cosine, MODEL };
