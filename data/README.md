# `data/` — Local Data

Per [ADR-003](../docs/decisions.md) the MVP uses local data only (no PostgreSQL,
no external vector database).

| Directory       | Contents | Introduced in |
|-----------------|----------|---------------|
| `business/`     | Local JSON business data (orders, invoices, inventory) | Phase 3 (Knowledge Sources) |
| `pdfs/`         | Company policy PDFs — the knowledge sources for semantic retrieval | Phase 3 (Knowledge Sources) |
| `vector-index/` | Generated local vector index for semantic PDF retrieval (git-ignored); build with `npm run build:index` | Phase 4 (Retrieval) |

The editable Markdown source for the policy PDFs lives in
[`docs/policies/`](../docs/policies/), not under `data/`.

`vector-index/` and `tmp/` are generated at runtime and are excluded from version
control (see `.gitignore`).

## `business/` datasets

| File             | Records | Notes |
|------------------|---------|-------|
| `orders.json`    | Customer orders across `processing`, `shipped`, `delivered`, `cancelled`, and `returned` states | Each item references an inventory `sku`; money fields are internally consistent. |
| `invoices.json`  | One invoice per order across `unpaid`, `paid`, `partially_paid`, `overdue`, `refunded`, and `voided` states | Each `orderId` references an order; totals match the order. |
| `inventory.json` | Catalogue products across `in_stock`, `low_stock`, `out_of_stock`, `backordered`, and `discontinued` states | `sku` is the catalogue key referenced by orders. |

IDs and dates are deterministic. Run `npm run validate:data` to check that the
datasets parse and remain internally consistent (referential integrity, money
arithmetic, status coherence).

## `pdfs/` policy knowledge sources

`Customer Service Policy.pdf`, `Billing Policy.pdf`, and `Product Availability Policy.pdf`
cover the four supported workflows (cancellation, damaged item, invoice question,
product availability). They are the PDF knowledge sources consumed by Phase 4's semantic
retrieval pipeline (PDF → text extraction → chunking → local embeddings → local vector index).
Embeddings are produced by a local MiniLM model; the model weights are cached under
`data/models/` (git-ignored). See [`src/pipeline/retrieval/`](../src/pipeline/retrieval/) and
[ADR-008](../docs/decisions.md).

The PDFs are generated from the Markdown source in [`docs/policies/`](../docs/policies/),
which remains the editable source of truth. To regenerate them after editing the
Markdown:

```
python3 scripts/generate-policy-pdfs.py
```

The generator uses only the Python standard library (no third-party PDF toolchain).
