/**
 * Local business data — load, validate and index the JSON knowledge sources.
 *
 * Responsibility: read `data/business/{orders,invoices,inventory}.json` once, validate each
 * record against its contract (a file read from disk is untrusted input, per ADR-003), and
 * expose fast lookup maps for the Structured Data Retrieval stage. This module only *reads*
 * data; it contains no business rules and makes no decisions.
 *
 * The loaded data is cached for the process. Tests or scripts can force a reload or point at
 * a different directory via {@link loadBusinessData}.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  InventoryRecordSchema,
  InvoiceRecordSchema,
  OrderRecordSchema,
} from '../../schemas';
import type { InventoryRecord, InvoiceRecord, OrderRecord } from '../../types';

/** Directory holding the local business datasets (Phase 3 knowledge sources). */
export const BUSINESS_DIR = resolve(process.cwd(), 'data', 'business');

/** The loaded datasets plus the lookup indexes built over them. */
export interface BusinessData {
  orders: OrderRecord[];
  invoices: InvoiceRecord[];
  inventory: InventoryRecord[];
  /** order id -> order */
  ordersById: Map<string, OrderRecord>;
  /** invoice id -> invoice */
  invoicesById: Map<string, InvoiceRecord>;
  /** order id -> invoice (each order has at most one invoice) */
  invoicesByOrderId: Map<string, InvoiceRecord>;
  /** sku -> product */
  inventoryBySku: Map<string, InventoryRecord>;
  /** normalized product name -> product */
  inventoryByName: Map<string, InventoryRecord>;
  /** lowercased customer email -> their orders */
  ordersByEmail: Map<string, OrderRecord[]>;
}

/** Normalize a product name for case/whitespace-insensitive matching. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Read a dataset file and validate it as an array of records. Throws on malformed input. */
function loadArray<T>(dir: string, file: string, schema: z.ZodType<T>): T[] {
  const raw = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as unknown;
  return z.array(schema).parse(raw);
}

/** Build the lookup indexes over a set of datasets. */
function index(
  orders: OrderRecord[],
  invoices: InvoiceRecord[],
  inventory: InventoryRecord[],
): BusinessData {
  const ordersByEmail = new Map<string, OrderRecord[]>();
  for (const order of orders) {
    const key = order.customerEmail.toLowerCase();
    const bucket = ordersByEmail.get(key);
    if (bucket) bucket.push(order);
    else ordersByEmail.set(key, [order]);
  }

  return {
    orders,
    invoices,
    inventory,
    ordersById: new Map(orders.map((o) => [o.orderId, o])),
    invoicesById: new Map(invoices.map((v) => [v.invoiceId, v])),
    invoicesByOrderId: new Map(invoices.map((v) => [v.orderId, v])),
    inventoryBySku: new Map(inventory.map((p) => [p.sku, p])),
    inventoryByName: new Map(inventory.map((p) => [normalizeName(p.name), p])),
    ordersByEmail,
  };
}

let cache: BusinessData | undefined;

export interface LoadOptions {
  /** Directory to read the datasets from (default {@link BUSINESS_DIR}). */
  dir?: string;
  /** Bypass and refresh the process cache. */
  force?: boolean;
}

/**
 * Load, validate and index the local business data, caching the result for the process.
 * Pass `force` to reload, or `dir` to read from a non-default location (which is never cached).
 */
export function loadBusinessData(options: LoadOptions = {}): BusinessData {
  const dir = options.dir ?? BUSINESS_DIR;
  const useCache = dir === BUSINESS_DIR && !options.force;

  if (useCache && cache) return cache;

  const orders = loadArray(dir, 'orders.json', OrderRecordSchema);
  const invoices = loadArray(dir, 'invoices.json', InvoiceRecordSchema);
  const inventory = loadArray(dir, 'inventory.json', InventoryRecordSchema);
  const data = index(orders, invoices, inventory);

  if (useCache) cache = data;
  return data;
}
