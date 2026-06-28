/**
 * Phase 3 knowledge-source validation.
 *
 * A deliberately lightweight, dependency-free (beyond Zod) check that the local
 * business datasets are well-formed and internally consistent. It is NOT a test
 * framework and does not exercise any pipeline code — it only validates the JSON
 * knowledge sources created in Phase 3 so later phases can rely on them.
 *
 * Run with:  npm run validate:data
 * Exits 0 when every dataset is valid, 1 on the first batch of errors.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const BUSINESS_DIR = resolve(process.cwd(), 'data', 'business');

const MONEY_TOLERANCE = 0.005;
const TAX_RATE = 0.08;
const FREE_SHIPPING_THRESHOLD = 150;
const FLAT_SHIPPING = 7.95;

// --- Schemas -------------------------------------------------------------

const SkuSchema = z.string().regex(/^SKU-[A-Z0-9-]+$/, 'sku must look like SKU-XXX');
const OrderIdSchema = z.string().regex(/^\d{5}$/, 'orderId must be a 5-digit string');
const InvoiceIdSchema = z.string().regex(/^INV-\d{4}-\d{4}$/, 'invoiceId must look like INV-YYYY-NNNN');
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const IsoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'datetime must be ISO-8601 UTC');
const Money = z.number().nonnegative();

const InventoryItemSchema = z.object({
  sku: SkuSchema,
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  price: Money,
  currency: z.literal('USD'),
  availability: z.enum(['in_stock', 'low_stock', 'out_of_stock', 'backordered', 'discontinued']),
  quantityOnHand: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative(),
  restockDate: IsoDate.nullable(),
  discontinued: z.boolean(),
});

const OrderItemSchema = z.object({
  sku: SkuSchema,
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: Money,
});

const OrderSchema = z.object({
  orderId: OrderIdSchema,
  customerEmail: z.string().email(),
  customerName: z.string().min(1),
  status: z.enum(['processing', 'shipped', 'delivered', 'cancelled', 'returned']),
  placedAt: IsoDateTime,
  shippedAt: IsoDateTime.nullable(),
  deliveredAt: IsoDateTime.nullable(),
  cancelledAt: IsoDateTime.nullable(),
  returnedAt: IsoDateTime.nullable(),
  shippingMethod: z.enum(['standard', 'express']),
  shippingAddress: z.object({
    line1: z.string().min(1),
    city: z.string().min(1),
    region: z.string().min(1),
    postalCode: z.string().min(1),
    country: z.string().min(1),
  }),
  items: z.array(OrderItemSchema).min(1),
  currency: z.literal('USD'),
  subtotal: Money,
  shipping: Money,
  tax: Money,
  total: Money,
});

const InvoiceSchema = z.object({
  invoiceId: InvoiceIdSchema,
  orderId: OrderIdSchema,
  customerEmail: z.string().email(),
  customerName: z.string().min(1),
  status: z.enum(['unpaid', 'paid', 'partially_paid', 'overdue', 'refunded', 'voided']),
  issueDate: IsoDate,
  dueDate: IsoDate,
  paymentMethod: z.enum(['credit_card', 'paypal', 'bank_transfer']).nullable(),
  paidDate: IsoDate.nullable(),
  refundDate: IsoDate.nullable(),
  currency: z.literal('USD'),
  subtotal: Money,
  shipping: Money,
  tax: Money,
  total: Money,
  amountPaid: Money,
  amountRefunded: Money,
  amountDue: Money,
  notes: z.string().nullable(),
});

type Order = z.infer<typeof OrderSchema>;
type Invoice = z.infer<typeof InvoiceSchema>;
type InventoryItem = z.infer<typeof InventoryItemSchema>;

// --- Helpers -------------------------------------------------------------

const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);
const near = (a: number, b: number) => Math.abs(a - b) <= MONEY_TOLERANCE;
const round2 = (n: number) => Math.round(n * 100) / 100;

function load<T>(file: string, schema: z.ZodType<T>): T[] {
  const raw = JSON.parse(readFileSync(resolve(BUSINESS_DIR, file), 'utf8')) as unknown;
  if (!Array.isArray(raw)) {
    fail(`${file}: expected a top-level array`);
    return [];
  }
  const out: T[] = [];
  raw.forEach((record, i) => {
    const parsed = schema.safeParse(record);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      for (const issue of parsed.error.issues) {
        fail(`${file}[${i}] ${issue.path.join('.') || '(root)'}: ${issue.message}`);
      }
    }
  });
  return out;
}

function assertUnique(file: string, ids: string[], label: string) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail(`${file}: duplicate ${label} "${id}"`);
    seen.add(id);
  }
}

// --- Load ----------------------------------------------------------------

const inventory = load<InventoryItem>('inventory.json', InventoryItemSchema);
const orders = load<Order>('orders.json', OrderSchema);
const invoices = load<Invoice>('invoices.json', InvoiceSchema);

// --- Uniqueness ----------------------------------------------------------

assertUnique('inventory.json', inventory.map((p) => p.sku), 'sku');
assertUnique('orders.json', orders.map((o) => o.orderId), 'orderId');
assertUnique('invoices.json', invoices.map((v) => v.invoiceId), 'invoiceId');

// --- Inventory consistency ----------------------------------------------

for (const p of inventory) {
  const needsRestock = p.availability === 'out_of_stock' || p.availability === 'backordered';
  if (needsRestock && p.restockDate === null) {
    fail(`inventory ${p.sku}: status "${p.availability}" requires a restockDate`);
  }
  if (p.availability === 'discontinued') {
    if (!p.discontinued) fail(`inventory ${p.sku}: discontinued status but discontinued flag is false`);
    if (p.restockDate !== null) fail(`inventory ${p.sku}: discontinued items must not have a restockDate`);
  }
  if (p.availability === 'in_stock' && p.quantityOnHand <= p.lowStockThreshold) {
    fail(`inventory ${p.sku}: in_stock but quantity ${p.quantityOnHand} <= threshold ${p.lowStockThreshold}`);
  }
  if (p.availability === 'low_stock' && !(p.quantityOnHand > 0 && p.quantityOnHand <= p.lowStockThreshold)) {
    fail(`inventory ${p.sku}: low_stock but quantity ${p.quantityOnHand} is outside (0, threshold]`);
  }
  if ((p.availability === 'out_of_stock' || p.availability === 'backordered' || p.availability === 'discontinued') && p.quantityOnHand !== 0) {
    fail(`inventory ${p.sku}: status "${p.availability}" requires quantityOnHand 0`);
  }
}

// --- Order consistency ---------------------------------------------------

const skus = new Set(inventory.map((p) => p.sku));

for (const o of orders) {
  for (const item of o.items) {
    if (!skus.has(item.sku)) fail(`order ${o.orderId}: item sku "${item.sku}" not found in inventory`);
  }
  const subtotal = round2(o.items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0));
  if (!near(subtotal, o.subtotal)) fail(`order ${o.orderId}: subtotal ${o.subtotal} != sum of items ${subtotal}`);

  const expectedShipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING;
  if (!near(expectedShipping, o.shipping)) fail(`order ${o.orderId}: shipping ${o.shipping} != expected ${expectedShipping}`);

  const expectedTax = round2(subtotal * TAX_RATE);
  if (!near(expectedTax, o.tax)) fail(`order ${o.orderId}: tax ${o.tax} != expected ${expectedTax}`);

  if (!near(round2(o.subtotal + o.shipping + o.tax), o.total)) {
    fail(`order ${o.orderId}: total ${o.total} != subtotal + shipping + tax`);
  }

  // Status / timestamp coherence.
  if (o.status === 'shipped' && o.shippedAt === null) fail(`order ${o.orderId}: shipped but no shippedAt`);
  if (o.status === 'delivered' && (o.shippedAt === null || o.deliveredAt === null)) {
    fail(`order ${o.orderId}: delivered but missing shippedAt/deliveredAt`);
  }
  if (o.status === 'cancelled' && o.cancelledAt === null) fail(`order ${o.orderId}: cancelled but no cancelledAt`);
  if (o.status === 'returned' && o.returnedAt === null) fail(`order ${o.orderId}: returned but no returnedAt`);
}

// --- Invoice consistency -------------------------------------------------

const ordersById = new Map(orders.map((o) => [o.orderId, o]));

for (const v of invoices) {
  const order = ordersById.get(v.orderId);
  if (!order) {
    fail(`invoice ${v.invoiceId}: orderId "${v.orderId}" not found in orders`);
  } else {
    if (v.customerEmail !== order.customerEmail) {
      fail(`invoice ${v.invoiceId}: customerEmail does not match order ${order.orderId}`);
    }
    if (!near(v.total, order.total)) {
      fail(`invoice ${v.invoiceId}: total ${v.total} != order total ${order.total}`);
    }
  }

  if (!near(round2(v.subtotal + v.shipping + v.tax), v.total)) {
    fail(`invoice ${v.invoiceId}: total ${v.total} != subtotal + shipping + tax`);
  }

  // Payment-state coherence by status.
  switch (v.status) {
    case 'unpaid':
    case 'overdue':
      if (!near(v.amountPaid, 0) || !near(v.amountDue, v.total) || !near(v.amountRefunded, 0)) {
        fail(`invoice ${v.invoiceId}: ${v.status} must have amountPaid 0, amountDue total, amountRefunded 0`);
      }
      break;
    case 'paid':
      if (!near(v.amountPaid, v.total) || !near(v.amountDue, 0) || !near(v.amountRefunded, 0)) {
        fail(`invoice ${v.invoiceId}: paid must have amountPaid total, amountDue 0, amountRefunded 0`);
      }
      break;
    case 'partially_paid':
      if (!(v.amountPaid > 0 && v.amountPaid < v.total) || !near(v.amountDue, round2(v.total - v.amountPaid))) {
        fail(`invoice ${v.invoiceId}: partially_paid must have 0 < amountPaid < total and amountDue = total - amountPaid`);
      }
      break;
    case 'refunded':
      if (!near(v.amountPaid, v.total) || !near(v.amountRefunded, v.total) || !near(v.amountDue, 0)) {
        fail(`invoice ${v.invoiceId}: refunded must have amountPaid total, amountRefunded total, amountDue 0`);
      }
      if (v.refundDate === null) fail(`invoice ${v.invoiceId}: refunded must have a refundDate`);
      break;
    case 'voided':
      if (!near(v.amountPaid, 0) || !near(v.amountDue, 0) || !near(v.amountRefunded, 0)) {
        fail(`invoice ${v.invoiceId}: voided must have amountPaid 0, amountDue 0, amountRefunded 0`);
      }
      break;
  }
}

// Every order should have exactly one invoice.
const invoicedOrderIds = invoices.map((v) => v.orderId);
assertUnique('invoices.json', invoicedOrderIds, 'orderId reference');
for (const o of orders) {
  if (!invoicedOrderIds.includes(o.orderId)) fail(`order ${o.orderId}: has no invoice`);
}

// --- Report --------------------------------------------------------------

if (errors.length > 0) {
  console.error(`Data validation FAILED with ${errors.length} issue(s):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('Data validation passed.');
console.log(`  inventory: ${inventory.length} products`);
console.log(`  orders:    ${orders.length} orders`);
console.log(`  invoices:  ${invoices.length} invoices`);
