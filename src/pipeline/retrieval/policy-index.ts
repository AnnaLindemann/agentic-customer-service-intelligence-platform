/**
 * Policy vector index — build, persist and load the local index.
 *
 * Responsibility: orchestrate extraction -> chunking -> embedding into a single
 * serializable index, and read/write it under `data/vector-index/` (git-ignored, per
 * `data/README.md`). This is the "local vector index" the architecture refers to; embeddings
 * are stored locally in `policy-index.json` and there is no external vector database (ADR-003).
 *
 * The persisted file is validated with Zod on load, following the same defensive pattern as
 * the Phase 3 data validator — a file read from disk is untrusted input.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { chunkPages, type PolicyChunk } from './chunking';
import { extractPdfPages } from './pdf-text';
import { EMBEDDING_DIM, EMBEDDING_MODEL, embedMany } from './embeddings';

/** Directory holding the source policy PDFs (Phase 3 knowledge sources). */
export const PDF_DIR = resolve(process.cwd(), 'data', 'pdfs');
/** Directory for the generated local vector index (git-ignored). */
export const INDEX_DIR = resolve(process.cwd(), 'data', 'vector-index');
/** Path of the persisted policy index. */
export const INDEX_PATH = resolve(INDEX_DIR, 'policy-index.json');

// Bumped from 1 (TF-IDF, sparse vectors) to 2 (MiniLM, dense vectors). A version or model
// mismatch triggers a rebuild in `ensureIndex`.
const INDEX_VERSION = 2;

/** A chunk plus its precomputed, L2-normalized dense embedding. */
const IndexedChunkSchema = z.object({
  ref: z.string(),
  slug: z.string(),
  file: z.string(),
  page: z.number().int().positive(),
  heading: z.string(),
  text: z.string(),
  vector: z.array(z.number()),
});

/** The full persisted index: model metadata and the embedded chunks. */
export const PolicyIndexSchema = z.object({
  version: z.literal(INDEX_VERSION),
  builtAt: z.string(),
  model: z.string(),
  dim: z.number().int().positive(),
  chunks: z.array(IndexedChunkSchema),
});

export type IndexedChunk = z.infer<typeof IndexedChunkSchema>;
export type PolicyIndex = z.infer<typeof PolicyIndexSchema>;

/** Read and chunk every policy PDF in `PDF_DIR`, sorted by file name for deterministic output. */
function loadChunks(): PolicyChunk[] {
  const files = readdirSync(PDF_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();

  return files.flatMap((file) => chunkPages(file, extractPdfPages(resolve(PDF_DIR, file))));
}

/** Build the policy index from the source PDFs, embedding each passage with the local model. */
export async function buildIndex(): Promise<PolicyIndex> {
  const chunks = loadChunks();
  const vectors = await embedMany(chunks.map((c) => c.text));

  const indexedChunks: IndexedChunk[] = chunks.map((chunk, i) => ({
    ...chunk,
    vector: vectors[i],
  }));

  return {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    model: EMBEDDING_MODEL,
    dim: EMBEDDING_DIM,
    chunks: indexedChunks,
  };
}

/** Persist the index to `INDEX_PATH`, creating the directory if needed. */
export function saveIndex(index: PolicyIndex): void {
  mkdirSync(INDEX_DIR, { recursive: true });
  writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

/** Load and validate the persisted index. Throws if the file is missing or malformed. */
export function loadIndex(): PolicyIndex {
  const raw = JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as unknown;
  return PolicyIndexSchema.parse(raw);
}

/**
 * Return the persisted index, rebuilding it when missing, malformed, or built with a
 * different embedding model. Lets the retrieval stage work out-of-the-box while still
 * supporting an explicit build step (`npm run build:index`).
 */
export async function ensureIndex(): Promise<PolicyIndex> {
  if (existsSync(INDEX_PATH)) {
    try {
      const index = loadIndex();
      if (index.model === EMBEDDING_MODEL) return index;
    } catch {
      // Corrupt or outdated (e.g. previous schema version) — fall through and rebuild.
    }
  }
  const index = await buildIndex();
  saveIndex(index);
  return index;
}
