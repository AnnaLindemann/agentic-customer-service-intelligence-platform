# Product Availability Policy

**Document owner:** Merchandising & Inventory
**Version:** 1.0
**Effective date:** 2026-01-01

## 1. Purpose and Scope

This policy defines how Harbor & Pine Outfitters describes product availability and
how availability questions received by email are answered. Availability answers must
be grounded in the current inventory record for the product.

## 2. Availability Statuses

Every product carries exactly one availability status:

| Status         | Meaning |
|----------------|---------|
| `in_stock`     | Available now; on-hand quantity is above the low-stock threshold. |
| `low_stock`    | Available now, but on-hand quantity is at or below the low-stock threshold. |
| `out_of_stock` | Temporarily unavailable; a restock date is expected. |
| `backordered`  | Orderable now but not yet in stock; ships on the restock date. |
| `discontinued` | No longer sold; will not be restocked. |

## 3. On-Hand Quantity and Thresholds

Each product records an on-hand quantity and a low-stock threshold. A product is
considered low on stock when its on-hand quantity is greater than zero but at or below
its threshold. Exact on-hand quantities are used internally to determine status and
are not quoted to customers; customers are told the status only (for example,
"in stock" or "low stock"), not the precise count.

## 4. Restock and Backorder

### 4.1 Out-of-stock items

An out-of-stock item carries an expected restock date. The customer may be told the
expected restock date and invited to order once the item is back in stock.

### 4.2 Backordered items

A backordered item can be ordered immediately and is expected to ship on its restock
date. The customer should be told the expected ship date before ordering.

### 4.3 Discontinued items

A discontinued item will not be restocked. Where a successor product exists, the
customer may be informed of it, but only the existence of a successor that is recorded
in the catalogue may be mentioned. No restock date is given for discontinued items.

## 5. Answering Availability Questions

When a customer asks whether a product is available, the answer must be grounded in
the product's current inventory record. Answers follow this pattern:

- **`in_stock`** — Confirm the product is available to order now.
- **`low_stock`** — Confirm it is available but note that stock is limited.
- **`out_of_stock`** — State that it is temporarily unavailable and give the expected
  restock date.
- **`backordered`** — State that it can be ordered now and give the expected ship date.
- **`discontinued`** — State that it is no longer available and, if applicable, mention
  a recorded successor product.

Prices quoted to a customer must match the price recorded in the inventory record.

## 6. Product Not Found

If the product the customer refers to cannot be matched to a catalogue record, the
request is escalated to a human agent under the
[Customer Service Policy](customer-service-policy.md). Availability must never be
guessed for a product that is not in the catalogue.

## 7. Accuracy

Availability statuses reflect the inventory record at the time of the response. A
status may change between responses as stock levels move; answers must always be based
on the current record rather than a previously cached value.
