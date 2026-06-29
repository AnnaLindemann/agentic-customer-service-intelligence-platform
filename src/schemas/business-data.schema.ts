import { z } from 'zod';

/**
 * Contracts for the persisted local business data (`data/business/*.json`) that the
 * Structured Data Retrieval stage reads.
 *
 * These describe the *shape* of the knowledge sources created in Phase 3 so retrieval can
 * load and type them safely — a file read from disk is untrusted input and is validated on
 * load, the same defensive pattern used by the policy index (ADR-003).
 *
 * Cross-record integrity (totals add up, every order has an invoice, …) is intentionally
 * NOT enforced here; that belongs to the standalone `validate-data` integrity checker. Here
 * we only validate that each record is individually well-formed before it is returned as a
 * retrieved fact.
 */

const SkuSchema = z.string().regex(/^SKU-[A-Z0-9-]+$/);
const OrderIdSchema = z.string().regex(/^\d{5}$/);
const InvoiceIdSchema = z.string().regex(/^INV-\d{4}-\d{4}$/);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
const Money = z.number().nonnegative();

/** A product in the local inventory dataset. */
export const InventoryRecordSchema = z.object({
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

/** A single line item within an order. */
export const OrderItemRecordSchema = z.object({
  sku: SkuSchema,
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: Money,
});

/** An order in the local orders dataset. */
export const OrderRecordSchema = z.object({
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
  items: z.array(OrderItemRecordSchema).min(1),
  currency: z.literal('USD'),
  subtotal: Money,
  shipping: Money,
  tax: Money,
  total: Money,
});

/** An invoice in the local invoices dataset. */
export const InvoiceRecordSchema = z.object({
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
