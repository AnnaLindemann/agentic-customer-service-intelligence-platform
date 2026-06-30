/**
 * Structured Data Retrieval — the pipeline stage.
 *
 * Responsibility: given the structured slots extracted from an email, look up the matching
 * business facts in the local JSON data (orders, invoices, inventory) and return them as
 * citable, schema-validated sources. This is a deterministic key-based lookup: it finds and
 * returns raw records. It deliberately makes **no** judgement about them — no eligibility,
 * no windows, no sufficiency. Those are later stages (Data Sufficiency Evaluation, Business
 * Rule Engine). See ADR-001 ("LLMs interpret. Rules decide.") and ADR-002.
 *
 * Every attempted lookup is recorded (found or not) so the step is explainable.
 */
import { StructuredSourceSchema } from '../../schemas';
import { createHash } from 'node:crypto';
import type { ExtractedSlots, InventoryRecord, StructuredLookup, StructuredSource } from '../../types';
import {
  loadBusinessData,
  normalizeName,
  type BusinessData,
} from './business-data';

/** The slot fields Structured Data Retrieval can resolve against business data. */
export type StructuredQuery = Pick<
  ExtractedSlots,
  'orderId' | 'invoiceId' | 'productName' | 'customerEmail'
>;

export interface StructuredRetrievalOptions {
  /** A preloaded dataset to look up against. Defaults to the cached local business data. */
  data?: BusinessData;
}

/** The result of structured retrieval: the facts found and a log of every attempted lookup. */
export interface StructuredRetrievalResult {
  sources: StructuredSource[];
  lookups: StructuredLookup[];
}

/** A factual, derived summary of a customer, aggregated from their orders. */
interface CustomerFacts extends Record<string, unknown> {
  customerEmail: string;
  customerName: string | null;
  orderIds: string[];
  invoiceIds: string[];
}

/** Stable pseudonymous reference; raw customer e-mail addresses must never become evidence refs. */
function customerRef(email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
  return `customer:${digest}`;
}

/**
 * Retrieve business facts for the given slots.
 *
 * Lookups are independent and order-stable:
 *   - `orderId`      -> the order, and that order's invoice if no `invoiceId` was given;
 *   - `invoiceId`    -> the invoice;
 *   - `productName`  -> the inventory item (exact normalized name, then a contains match);
 *   - `customerEmail`-> a factual summary of the customer's orders/invoices.
 *
 * A lookup that finds nothing still appears in `lookups` (with `found: false`) but adds no
 * source. Sources are de-duplicated by `ref` (e.g. an invoice reached via both `invoiceId`
 * and `orderId` is returned once).
 */
export function retrieveStructuredFacts(
  slots: StructuredQuery,
  options: StructuredRetrievalOptions = {},
): StructuredRetrievalResult {
  const data = options.data ?? loadBusinessData();

  const sources: StructuredSource[] = [];
  const lookups: StructuredLookup[] = [];
  const seenRefs = new Set<string>();

  const add = (kind: StructuredSource['kind'], ref: string, record: Record<string, unknown>) => {
    if (seenRefs.has(ref)) return;
    seenRefs.add(ref);
    sources.push(StructuredSourceSchema.parse({ ref, kind, data: record }));
  };

  const orderId = slots.orderId?.trim();
  const invoiceId = slots.invoiceId?.trim();
  const productName = slots.productName?.trim();
  const customerEmail = slots.customerEmail?.trim();

  // --- order (by id) ---
  if (orderId) {
    const order = data.ordersById.get(orderId);
    lookups.push({ kind: 'order', key: orderId, found: Boolean(order), ref: order && `order:${order.orderId}` });
    if (order) add('order', `order:${order.orderId}`, order);

    // The invoice for this order is useful context (e.g. invoice questions referencing an
    // order). Only resolve it here when no explicit invoiceId was supplied.
    if (!invoiceId) {
      const invoice = data.invoicesByOrderId.get(orderId);
      if (invoice) {
        lookups.push({ kind: 'invoice', key: orderId, found: true, ref: `invoice:${invoice.invoiceId}` });
        add('invoice', `invoice:${invoice.invoiceId}`, invoice);
      }
    }
  }

  // --- invoice (by id) ---
  if (invoiceId) {
    const invoice = data.invoicesById.get(invoiceId);
    lookups.push({ kind: 'invoice', key: invoiceId, found: Boolean(invoice), ref: invoice && `invoice:${invoice.invoiceId}` });
    if (invoice) add('invoice', `invoice:${invoice.invoiceId}`, invoice);
  }

  // --- product (by name) ---
  if (productName) {
    const product = findProduct(data, productName);
    lookups.push({ kind: 'product', key: productName, found: Boolean(product), ref: product && `product:${product.sku}` });
    if (product) add('product', `product:${product.sku}`, product);
  }

  // --- customer (by email) ---
  if (customerEmail) {
    const facts = buildCustomerFacts(data, customerEmail);
    const ref = facts ? customerRef(facts.customerEmail) : undefined;
    lookups.push({ kind: 'customer', key: customerEmail, found: Boolean(facts), ref });
    if (facts && ref) add('customer', ref, facts);
  }

  return { sources, lookups };
}

/** Split a normalized product name into comparable word tokens. */
function tokenize(name: string): string[] {
  return normalizeName(name)
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0);
}

/**
 * Deterministically recover a catalogue product mentioned in free text (the masked email) when slot
 * extraction missed it. It scores each product by how much of its *name* the text covers, and
 * accepts the best only when it is distinctive and unambiguous:
 *
 *   - at least half of the product's name tokens appear in the text;
 *   - at least one matched token is "distinctive" (length ≥ 4), so a bare generic word like
 *     "backpack"/"bag" cannot trigger a match on its own;
 *   - exactly one product attains the top coverage (ties → `undefined`, so the gate still asks).
 *
 * It returns the product's canonical catalogue name (never PII), which the caller can feed back
 * through the normal deterministic lookup. This makes "Vista 45L Backpack" / "Vista Backpack"
 * resolve reliably without sending anything extra to the LLM (ADR-001/ADR-004).
 */
export function detectProductNameInText(
  text: string,
  options: StructuredRetrievalOptions = {},
): string | undefined {
  const data = options.data ?? loadBusinessData();
  const textTokens = new Set(tokenize(text));
  if (textTokens.size === 0) return undefined;

  let best: { name: string; score: number } | undefined;
  let bestCount = 0;
  for (const product of data.inventory) {
    const nameTokens = tokenize(product.name);
    if (nameTokens.length === 0) continue;
    const matched = nameTokens.filter((token) => textTokens.has(token));
    const score = matched.length / nameTokens.length;
    const distinctive = matched.some((token) => token.length >= 4);
    if (!distinctive) continue;
    if (best === undefined || score > best.score) {
      best = { name: product.name, score };
      bestCount = 1;
    } else if (score === best.score) {
      bestCount += 1;
    }
  }

  if (best && best.score >= 0.5 && bestCount === 1) return best.name;
  return undefined;
}

/**
 * Generic product-category words (German + English) that name a *type* of product we sell rather
 * than a specific item. They let the resolver tell an *under-specified* request ("ein Rucksack",
 * "a backpack") — which should ask the customer to be specific — apart from a *specific but absent*
 * product ("Banane") — which is a deterministic not-found. Used only to disambiguate the
 * zero-match case; a generic word that still uniquely matches one product resolves normally.
 */
const GENERIC_PRODUCT_TERMS = new Set([
  'backpack', 'rucksack', 'rucksäcke', 'daypack', 'tent', 'zelt', 'sleeping', 'schlafsack',
  'schlafmatte', 'isomatte', 'mat', 'matte', 'stove', 'kocher', 'boots', 'stiefel', 'schuhe',
  'wanderschuhe', 'jacket', 'jacke', 'regenjacke', 'flask', 'flasche', 'trinkflasche', 'lantern',
  'laterne', 'lampe', 'chair', 'stuhl', 'filter', 'wasserfilter', 'gloves', 'handschuhe', 'bag',
  'tasche', 'produkt', 'product', 'artikel', 'item',
]);

/** The deterministic outcome of resolving a product name against the catalogue. */
export type ProductResolution =
  | { status: 'resolved'; product: InventoryRecord }
  /** Several catalogue products match comparably — the customer must say which. */
  | { status: 'ambiguous'; candidates: string[] }
  /** A generic category we sell, but not a specific product — ask for the exact product. */
  | { status: 'underspecified' }
  /** A specific name was understood, retrieval ran, but the catalogue has no such product. */
  | { status: 'not_found' };

/**
 * Resolve a product name into one of four deterministic outcomes (improvement set):
 *
 *   - `resolved`      — an exact match, or a single unambiguous nearest match by query-token
 *                       coverage (e.g. "Vista 45L Backpack", or "Vista Backpack" when only one
 *                       Vista backpack exists);
 *   - `ambiguous`     — several products tie at the top coverage (e.g. "Vista" with three Vista
 *                       products) → ask which one;
 *   - `underspecified`— a generic category word with no single match (e.g. "Rucksack") → ask for
 *                       the specific product;
 *   - `not_found`     — a specific name that matches nothing in the catalogue (e.g. "Banane").
 *
 * Deterministic, no LLM. This is the single source of truth; `findProduct` is the boolean view.
 */
export function resolveProduct(productName: string, options: StructuredRetrievalOptions = {}): ProductResolution {
  const data = options.data ?? loadBusinessData();

  const exact = data.inventoryByName.get(normalizeName(productName));
  if (exact) return { status: 'resolved', product: exact };

  const queryTokens = tokenize(productName);
  if (queryTokens.length === 0) return { status: 'not_found' };

  let bestScore = 0;
  let topProducts: InventoryRecord[] = [];
  for (const product of data.inventory) {
    const productTokens = new Set(tokenize(product.name));
    const covered = queryTokens.filter((token) => productTokens.has(token)).length;
    const score = covered / queryTokens.length;
    if (score > bestScore) {
      bestScore = score;
      topProducts = [product];
    } else if (score === bestScore && score > 0) {
      topProducts.push(product);
    }
  }

  if (bestScore >= 0.5) {
    if (topProducts.length === 1) return { status: 'resolved', product: topProducts[0] };
    return { status: 'ambiguous', candidates: topProducts.map((product) => product.name) };
  }

  // No reasonable match: distinguish a generic category (ask for specifics) from a real not-found.
  const allGeneric = queryTokens.every((token) => GENERIC_PRODUCT_TERMS.has(token));
  return { status: allGeneric ? 'underspecified' : 'not_found' };
}

/** Boolean view of {@link resolveProduct}: the product record when uniquely resolved, else undefined. */
function findProduct(data: BusinessData, productName: string) {
  const resolution = resolveProduct(productName, { data });
  return resolution.status === 'resolved' ? resolution.product : undefined;
}

/**
 * Build a factual customer summary from the orders on file for an email. Returns `undefined`
 * when the customer is unknown. This aggregates references only — it derives no judgement.
 */
function buildCustomerFacts(data: BusinessData, email: string): CustomerFacts | undefined {
  const orders = data.ordersByEmail.get(email.toLowerCase());
  if (!orders || orders.length === 0) return undefined;

  const orderIds = orders.map((o) => o.orderId);
  const invoiceIds = orderIds
    .map((id) => data.invoicesByOrderId.get(id)?.invoiceId)
    .filter((id): id is string => Boolean(id));

  return {
    customerEmail: email,
    customerName: orders[0].customerName ?? null,
    orderIds,
    invoiceIds,
  };
}
