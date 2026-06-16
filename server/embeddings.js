/**
 * FRIDAY embeddings — turns text into vectors for semantic memory (RAG).
 * Runs a LOCAL model (all-MiniLM-L6-v2 via transformers.js) entirely
 * in-process: no API key, no cost, nothing leaves the machine. Weights are
 * downloaded once (~23MB) to the transformers.js cache and reused thereafter.
 * Produces 384-dim, L2-normalized vectors.
 */

require("dotenv").config();

const MODEL = process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
const DIM = 384;

// Lazy singleton — load the model once per process. transformers.js is ESM-only,
// so we reach it via dynamic import from this CommonJS module.
let _extractorPromise = null;
const extractor = () => {
  if (!_extractorPromise) {
    _extractorPromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      // Don't try to hit a local model dir; use the hub cache only.
      env.allowLocalModels = false;
      return pipeline("feature-extraction", MODEL);
    })();
  }
  return _extractorPromise;
};

// Embed a single string → number[] (384, normalized)
const embed = async (text) => {
  const ex = await extractor();
  const out = await ex([(text || " ").slice(0, 8000) || " "], { pooling: "mean", normalize: true });
  return Array.from(out.data).slice(0, DIM);
};

// Embed many strings in batches → number[][] (order preserved)
const embedBatch = async (texts, batchSize = 64) => {
  const ex = await extractor();
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const chunk = texts.slice(i, i + batchSize).map((t) => (t || " ").slice(0, 8000) || " ");
    const res = await ex(chunk, { pooling: "mean", normalize: true });
    // res.data is a flat Float32Array of shape [chunk.length, DIM]
    for (let r = 0; r < chunk.length; r++) {
      out.push(Array.from(res.data.slice(r * DIM, (r + 1) * DIM)));
    }
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

module.exports = { embed, embedBatch, cosine, MODEL, DIM };
