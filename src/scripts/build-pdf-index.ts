/**
 * Build the local policy vector index from the source PDFs.
 *
 * Extracts text from each policy PDF in `data/pdfs/`, chunks it by section, embeds each
 * passage with the local MiniLM model, and writes the index to
 * `data/vector-index/policy-index.json` (git-ignored). Re-run this after editing the
 * policies and regenerating the PDFs. The embedding model is downloaded once and cached
 * under `data/models/` (git-ignored).
 *
 * Run with:  npm run build:index
 */
import { relative } from 'node:path';
import { buildIndex, INDEX_PATH, saveIndex } from '../pipeline/retrieval';

async function main(): Promise<void> {
  const index = await buildIndex();
  saveIndex(index);

  const docs = new Set(index.chunks.map((c) => c.file));
  console.log('Policy vector index built.');
  console.log(`  model:      ${index.model} (${index.dim}-dim)`);
  console.log(`  documents:  ${docs.size}`);
  console.log(`  passages:   ${index.chunks.length}`);
  console.log(`  written to: ${relative(process.cwd(), INDEX_PATH)}`);
}

main().catch((err) => {
  console.error('Failed to build policy vector index:');
  console.error(err);
  process.exit(1);
});
