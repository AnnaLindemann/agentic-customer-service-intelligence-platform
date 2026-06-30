import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProductNameInText, resolveProduct, retrieveStructuredFacts } from '../pipeline/retrieval';

test('detectProductNameInText recovers a catalogue product from free text', () => {
  // Exact mention.
  assert.equal(
    detectProductNameInText('ist der Vista 45L Backpack auf Lager und sofort lieferbar?'),
    'Vista 45L Backpack',
  );
  // English mention, distinctive token present, uniquely resolvable.
  assert.equal(
    detectProductNameInText('is the StormShield jacket in stock?'),
    'StormShield Rain Jacket',
  );
});

test('detectProductNameInText stays silent when the mention is generic or ambiguous', () => {
  // A bare generic word must not trigger a match.
  assert.equal(detectProductNameInText('do you have a chair for me?'), undefined);
  // "Vista Backpack" now ties across the Vista backpacks → ambiguous → no guess.
  assert.equal(detectProductNameInText('haben Sie den Vista Backpack vorrätig?'), undefined);
  // No product mentioned at all.
  assert.equal(detectProductNameInText('I would like to cancel my recent order, thanks'), undefined);
});

test('a recovered product name resolves through the normal deterministic lookup', () => {
  const recovered = detectProductNameInText('ist der Vista 45L Backpack auf Lager?');
  assert.ok(recovered);
  const { sources } = retrieveStructuredFacts({ productName: recovered });
  const product = sources.find((source) => source.kind === 'product');
  assert.ok(product, 'recovered name should resolve to a product record');
  assert.equal(product?.data.sku, 'SKU-PACK-45L');
});

test('resolveProduct classifies the four deterministic product outcomes', () => {
  // CASE 2 — exact / unique match.
  const resolved = resolveProduct('Vista 45L Backpack');
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.status === 'resolved' && resolved.product.sku, 'SKU-PACK-45L');

  // CASE 3 — multiple reasonable matches → ambiguous.
  const ambiguous = resolveProduct('Vista');
  assert.equal(ambiguous.status, 'ambiguous');
  assert.ok(
    ambiguous.status === 'ambiguous' && ambiguous.candidates.length >= 2,
    'several Vista products should be candidates',
  );

  // CASE 1 — a generic category word → under-specified (ask which product).
  assert.equal(resolveProduct('Rucksack').status, 'underspecified');
  assert.equal(resolveProduct('backpack').status, 'ambiguous'); // generic but ties to two packs

  // CASE 4 — a specific name absent from the catalogue → not_found.
  assert.equal(resolveProduct('Banane').status, 'not_found');
  assert.equal(resolveProduct('PlayStation 5').status, 'not_found');
});
