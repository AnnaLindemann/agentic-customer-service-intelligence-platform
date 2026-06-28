# `data/` — Local Data

Per [ADR-003](../docs/decisions.md) the MVP uses local data only (no PostgreSQL,
no external vector database).

| Directory       | Contents | Introduced in |
|-----------------|----------|---------------|
| `business/`     | Local JSON business data (customers, orders) | Phase 4 |
| `policies/`     | Policy PDF documents for grounding | Phase 4 |
| `vector-index/` | Generated local vector index (git-ignored) | Phase 4 |

`vector-index/` and `tmp/` are generated at runtime and are excluded from version
control (see `.gitignore`).
