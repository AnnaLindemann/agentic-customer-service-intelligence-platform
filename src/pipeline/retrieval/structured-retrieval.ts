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
import type { ExtractedSlots, StructuredLookup, StructuredSource } from '../../types';
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
    lookups.push({ kind: 'customer', key: customerEmail, found: Boolean(facts), ref: facts && `customer:${facts.customerEmail}` });
    if (facts) add('customer', `customer:${facts.customerEmail}`, facts);
  }

  return { sources, lookups };
}

/** Resolve a product by exact normalized name, falling back to a unique contains match. */
function findProduct(data: BusinessData, productName: string) {
  const exact = data.inventoryByName.get(normalizeName(productName));
  if (exact) return exact;

  const needle = normalizeName(productName);
  const matches = data.inventory.filter((p) => normalizeName(p.name).includes(needle));
  // Only accept a contains match when it is unambiguous.
  return matches.length === 1 ? matches[0] : undefined;
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
