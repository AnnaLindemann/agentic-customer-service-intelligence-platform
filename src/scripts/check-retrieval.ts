/**
 * Hybrid Retrieval Layer smoke check.
 *
 * A lightweight, dependency-free (beyond Zod, and the local embedding model) verification of
 * the Phase 5 retrieval stage. It exercises Structured Data Retrieval against the local
 * business data and the combined Hybrid Retrieval Layer against the policy index, asserting
 * the outputs are schema-valid and resolve the records we expect. It is NOT a unit-test
 * framework — it is a runnable confidence check, in the spirit of `validate-data`.
 *
 * Run with:  npm run check:retrieval
 * Exits 0 when every check passes, 1 otherwise.
 */
import { HybridRetrievalSchema } from '../schemas';
import { retrieveEvidence, retrieveStructuredFacts } from '../pipeline/retrieval';

const failures: string[] = [];
const check = (cond: boolean, msg: string) => {
  if (!cond) failures.push(msg);
};

async function main(): Promise<void> {
  // --- Structured Data Retrieval -----------------------------------------

  // Known order resolves, and its invoice is pulled in as context.
  const byOrder = retrieveStructuredFacts({ orderId: '10001' });
  check(
    byOrder.sources.some((s) => s.kind === 'order' && s.ref === 'order:10001'),
    'order 10001 should resolve to source order:10001',
  );
  check(
    byOrder.sources.some((s) => s.kind === 'invoice' && s.ref === 'invoice:INV-2026-0001'),
    "order 10001 should pull in its invoice INV-2026-0001",
  );

  // Explicit invoice id resolves.
  const byInvoice = retrieveStructuredFacts({ invoiceId: 'INV-2026-0001' });
  check(
    byInvoice.sources.some((s) => s.kind === 'invoice' && s.ref === 'invoice:INV-2026-0001'),
    'invoice INV-2026-0001 should resolve',
  );

  // Product name matches case-insensitively.
  const byProduct = retrieveStructuredFacts({ productName: 'summit 2-person tent' });
  check(
    byProduct.sources.some((s) => s.kind === 'product' && s.ref === 'product:SKU-TENT-2P'),
    'product name "summit 2-person tent" should resolve to SKU-TENT-2P',
  );

  // Customer facts aggregate the customer's orders.
  const byEmail = retrieveStructuredFacts({ customerEmail: 'emma.thompson@example.com' });
  const customer = byEmail.sources.find((s) => s.kind === 'customer');
  check(Boolean(customer), 'known customer email should resolve to a customer fact');
  check(
    Array.isArray(customer?.data.orderIds) && (customer?.data.orderIds as string[]).includes('10001'),
    "customer facts should list the customer's order 10001",
  );

  // Unknown keys are recorded as misses and add no source.
  const miss = retrieveStructuredFacts({ orderId: '99999' });
  check(miss.sources.length === 0, 'unknown order 99999 should return no sources');
  check(
    miss.lookups.some((l) => l.kind === 'order' && l.key === '99999' && l.found === false),
    'unknown order 99999 should be recorded as a failed lookup',
  );

  // --- Hybrid Retrieval Layer --------------------------------------------

  const hybrid = await retrieveEvidence({
    caseId: 'check-1',
    slots: { orderId: '10001', customerEmail: 'emma.thompson@example.com' },
    query: 'Can I cancel my order placed an hour ago?',
  });

  check(HybridRetrievalSchema.safeParse(hybrid).success, 'hybrid output must be schema-valid');
  check(hybrid.structuredFacts.length > 0, 'hybrid: should return structured facts');
  check(hybrid.metadata.policy.ran === true, 'hybrid: semantic retrieval should have run');
  check(hybrid.policyEvidence.length > 0, 'hybrid: should return policy evidence for a cancellation query');
  check(
    hybrid.policyEvidence.every((p) => p.score >= 0 && p.score <= 1),
    'hybrid: every similarity score must be in [0, 1]',
  );
  check(
    hybrid.metadata.policy.topScore !== null && hybrid.metadata.policy.indexChunks > 0,
    'hybrid: metadata should report a top score and a non-empty index',
  );

  // Empty query skips semantic retrieval entirely.
  const noQuery = await retrieveEvidence({ slots: { orderId: '10001' }, query: '   ' });
  check(noQuery.metadata.policy.ran === false, 'empty query: semantic retrieval should be skipped');
  check(noQuery.policyEvidence.length === 0, 'empty query: no policy evidence');
  check(noQuery.structuredFacts.length > 0, 'empty query: structured facts still returned');

  // --- Report ------------------------------------------------------------

  if (failures.length > 0) {
    console.error(`Hybrid Retrieval check FAILED with ${failures.length} issue(s):\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log('Hybrid Retrieval check passed.');
  console.log(`  structured facts (order 10001): ${byOrder.sources.map((s) => s.ref).join(', ')}`);
  console.log(`  policy evidence (cancellation): ${hybrid.policyEvidence.length} passage(s)`);
  console.log(`  top policy match: ${hybrid.policyEvidence[0]?.ref} (score ${hybrid.policyEvidence[0]?.score})`);
  console.log(`  timings(ms): structured=${hybrid.metadata.timings.structuredMs} semantic=${hybrid.metadata.timings.semanticMs} total=${hybrid.metadata.timings.totalMs}`);
}

main().catch((err) => {
  console.error('Hybrid Retrieval check crashed:');
  console.error(err);
  process.exit(1);
});
