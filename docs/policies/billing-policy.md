# Billing Policy

**Document owner:** Finance
**Version:** 1.0
**Effective date:** 2026-01-01

## 1. Purpose and Scope

This policy describes how Harbor & Pine Outfitters issues invoices, collects payment,
and processes refunds for consumer orders. It also defines how invoice questions
received by email are answered.

## 2. Invoices

### 2.1 Issuance

An invoice is issued for every order at the time the order is placed. Each invoice
references exactly one order and carries a unique identifier in the form
`INV-YYYY-NNNN`.

### 2.2 Invoice contents

Every invoice records:

- the order it relates to and the customer it was issued to;
- the subtotal, shipping, tax, and total amount;
- the amount paid, the amount refunded, and the amount still due;
- the issue date and the payment due date.

### 2.3 Currency and tax

All amounts are in US dollars (USD). Sales tax is applied at **8%** of the order
subtotal. Shipping is **free** for orders with a subtotal of **150 USD or more** and
a flat **7.95 USD** otherwise.

## 3. Payment Terms

Payment is due within **14 days** of the invoice issue date. Accepted payment methods
are credit card, PayPal, and bank transfer.

## 4. Invoice Statuses

An invoice carries exactly one of the following statuses:

| Status           | Meaning |
|------------------|---------|
| `unpaid`         | Issued, not yet paid, and not past its due date. |
| `paid`           | Paid in full; nothing is outstanding. |
| `partially_paid` | Part of the balance has been paid; a balance remains due. |
| `overdue`        | Unpaid after the due date has passed. |
| `refunded`       | Paid in full and then fully refunded. |
| `voided`         | Cancelled before payment; nothing is owed. |

## 5. Answering Invoice Questions

When a customer asks about an invoice, the answer must be grounded in the stored
invoice record. Common questions and how to answer them:

- **"How much do I owe?"** — Report the `amountDue` and the due date.
- **"Has my payment gone through?"** — Report the status and, if paid, the paid date.
- **"Why was I charged this amount?"** — Break down the subtotal, shipping, and tax.
- **"Is this invoice overdue?"** — An invoice is overdue only when its status is
  `overdue`.

If the invoice referenced by the customer cannot be located, or the question concerns
a dispute or a chargeback, the case is escalated to a human agent under the
[Customer Service Policy](customer-service-policy.md).

## 6. Refunds

### 6.1 When a refund is issued

A refund is issued when:

- an order is cancelled after payment has been captured;
- an approved damaged-item claim is resolved with a refund rather than a replacement;
- an undamaged item is returned within the 30-day return window.

### 6.2 How refunds are processed

Refunds are returned to the original payment method. A full refund sets the invoice
status to `refunded`, records the refunded amount, and leaves nothing due. Refunds are
normally processed within **5 to 10 business days**.

## 7. Overdue Accounts

A first reminder is sent when an invoice becomes overdue. Repeated non-payment is
handled by Finance and is outside the scope of automated email responses.

## 8. Disputes

Billing disputes, chargebacks, and requests for goodwill adjustments are not resolved
automatically. These are always escalated to a human agent.
