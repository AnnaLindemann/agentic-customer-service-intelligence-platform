/**
 * Embeddings — the "semantic" in Semantic PDF Retrieval.
 *
 * Responsibility: turn text into a dense, L2-normalized embedding using a small sentence
 * model that runs **locally**, and score two embeddings by cosine similarity.
 *
 * Per `docs/architecture.md` this is a deterministic stage: "cosine similarity over a local
 * index". We use a local sentence-embedding model (MiniLM) via `@huggingface/transformers`
 * (ONNX Runtime, CPU). The model weights are fetched once and cached on disk, after which
 * embedding is fully offline: there is **no external embedding API** at query or build time
 * and **no external vector database** — vectors live in the local index. The choice of dense
 * embeddings over the earlier TF-IDF model is recorded in `docs/decisions.md` (ADR-008).
 */
import { resolve } from 'node:path';

/** Small, fast, 384-dim sentence-embedding model with ONNX weights for Transformers.js. */
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
/** Output dimensionality of {@link EMBEDDING_MODEL}. */
export const EMBEDDING_DIM = 384;

/** The output tensor of the feature-extraction pipeline (the subset we use). */
interface EmbeddingTensor {
  data: Float32Array;
  dims: number[];
}

/**
 * Minimal structural type for the feature-extraction pipeline. Declared locally so this
 * CommonJS file need not type-import from the ESM-only `@huggingface/transformers`.
 */
type FeatureExtractor = (
  input: string | string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<EmbeddingTensor>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

/**
 * Load (once) and reuse the local feature-extraction pipeline.
 *
 * `@huggingface/transformers` is ESM-only, so it is loaded with a dynamic `import()` from
 * this CommonJS project. The model weights are cached inside the project (git-ignored) so
 * retrieval stays self-contained and offline after the first, one-time download.
 */
function extractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = import('@huggingface/transformers').then(async ({ env, pipeline }) => {
      env.cacheDir = resolve(process.cwd(), 'data', 'models');
      env.allowRemoteModels = true;
      const pipe = await pipeline('feature-extraction', EMBEDDING_MODEL);
      return pipe as unknown as FeatureExtractor;
    });
  }
  return extractorPromise;
}

/** Mean-pool + L2-normalize the model output into plain `number[]` rows. */
function toRows(data: Float32Array, count: number, dim: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push(Array.from(data.subarray(i * dim, (i + 1) * dim)));
  }
  return rows;
}

/** Embed a batch of texts into L2-normalized dense vectors (one row per input). */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extract = await extractor();
  const output = await extract(texts, { pooling: 'mean', normalize: true });
  const dim = output.dims[output.dims.length - 1];
  return toRows(output.data as Float32Array, texts.length, dim);
}

/** Embed a single text into an L2-normalized dense vector. */
export async function embed(text: string): Promise<number[]> {
  const [vector] = await embedMany([text]);
  return vector;
}

/**
 * Cosine similarity of two dense vectors, clamped to [0, 1].
 *
 * The model already L2-normalizes its output, but we compute the full cosine for safety.
 * Sentence embeddings can be slightly negative for unrelated text; clamping keeps the score
 * a valid `PDFRetrievalSchema` value and treats "anti-similar" as simply "not relevant".
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.min(1, Math.max(0, sim));
}
