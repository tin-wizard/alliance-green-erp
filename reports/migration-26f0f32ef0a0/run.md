# Migration rehearsal report

Generated 2026-11-12T07:48:40.462Z.

- Dump: `sha256:26f0f32ef0a0e13c5d24778df1885f019abe1f26a0da4fa5a3c5297373e8d9d9`
- Manifest: 2026-11-12.2
- Commit: rehearsal
- Mode: rehearsal
- Tables: 164 loaded, 4 dated duplicates skipped, 0 missing
- Rows: 371 staged of 371 expected; 299 mapped into the app; 141 exceptions; 0 row errors
- Parity: 49 matched, 0 differed, 0 errored of 62

## Expected versus actual, per group

Expected is the fixture manifest (the case matrix). Staged is what the loader actually read. Mapped is what reached `app` with a row map entry. Accounted adds rows that carry a recorded exception, because a policy skip or a decision is still an answer for that row. A staged row that is neither mapped nor exceptioned is the only genuine gap; a short staged count is never excused by a policy.

| # | Group | Tables | Expected | Staged | Mapped | Accounted | Policy skips | Mismatch |
|---:|---|---:|---:|---:|---:|---:|---:|---|
| 1 | lookups | 11 | 44 | 44 | 44 | 44 | 0 | none |
| 2 | parties | 7 | 35 | 35 | 35 | 35 | 2 | none |
| 3 | identity | 4 | 20 | 20 | 16 | 20 | 1 | none |
| 4 | parts | 12 | 34 | 34 | 34 | 34 | 1 | none |
| 5 | compliance | 5 | 14 | 14 | 12 | 14 | 1 | none |
| 6 | work-orders | 24 | 55 | 55 | 43 | 55 | 5 | none |
| 7 | quotes | 28 | 32 | 32 | 24 | 32 | 0 | none |
| 8 | purchasing | 20 | 44 | 44 | 43 | 44 | 0 | none |
| 9 | inventory | 7 | 22 | 22 | 7 | 22 | 13 | none |
| 10 | invoicing-rga | 12 | 33 | 33 | 21 | 33 | 5 | none |
| 11 | tjx | 23 | 15 | 15 | 6 | 15 | 0 | none |
| 12 | messaging-history | 11 | 23 | 23 | 14 | 23 | 3 | none |

## Runs

| Module | Phase | Status | Source rows | Transformed | Errors |
|---|---|---|---:|---:|---:|
| lookups | transform | passed | 44 | 44 | 0 |
| parties | transform | passed | 35 | 35 | 0 |
| identity | transform | passed | 20 | 20 | 0 |
| parts | transform | passed | 34 | 34 | 0 |
| compliance | transform | passed | 14 | 14 | 0 |
| work-orders | transform | passed | 55 | 55 | 0 |
| quotes | transform | passed | 32 | 32 | 0 |
| purchasing | transform | passed | 44 | 44 | 0 |
| inventory | transform | passed | 22 | 22 | 0 |
| invoicing-rga | transform | passed | 33 | 33 | 0 |
| tjx | transform | passed | 15 | 15 | 0 |
| messaging-history | transform | passed | 23 | 23 | 0 |
| lookups | settle | passed | 44 | 44 | 0 |
| parties | settle | passed | 35 | 35 | 0 |
| identity | settle | passed | 20 | 20 | 0 |
| parts | settle | passed | 34 | 34 | 0 |
| compliance | settle | passed | 14 | 14 | 0 |
| work-orders | settle | passed | 55 | 55 | 0 |
| quotes | settle | passed | 32 | 32 | 0 |
| purchasing | settle | passed | 44 | 44 | 0 |
| inventory | settle | passed | 22 | 22 | 0 |
| invoicing-rga | settle | passed | 33 | 33 | 0 |
| tjx | settle | passed | 15 | 15 | 0 |
| messaging-history | settle | passed | 23 | 23 | 0 |
| lookups | verify | passed | 44 | 44 | 0 |
| parties | verify | passed | 35 | 35 | 0 |
| identity | verify | passed | 20 | 20 | 0 |
| parts | verify | passed | 34 | 34 | 0 |
| compliance | verify | passed | 14 | 14 | 0 |
| work-orders | verify | passed | 55 | 55 | 0 |
| quotes | verify | passed | 32 | 32 | 0 |
| purchasing | verify | passed | 44 | 44 | 0 |
| inventory | verify | passed | 22 | 22 | 0 |
| invoicing-rga | verify | passed | 33 | 33 | 0 |
| tjx | verify | passed | 15 | 15 | 0 |
| messaging-history | verify | passed | 23 | 23 | 0 |

## Idempotency

Pass 1 errors 0, pass 2 errors 0; parity differed 0 then 0.

The second pass changed no app row counts: the import is re-runnable.

User cohorts: duplicate-username 2, disabled 3, orphan-vendor 1, no-email 1, shared-email 2, unique-email 3.

