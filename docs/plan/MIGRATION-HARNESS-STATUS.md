# Migration harness: build status

**Status:** built, rehearsing against the synthetic dump. **Date:** 2026-11-12.
**Spec:** `plan/modules/MIGRATION-HARNESS.md`. **Plan:** `plan/CUTOVER-AND-MIGRATION.md` §2, §5, §6.
**Fixture:** `fixtures/legacy/alliance_db_synthetic.sql` (`sha256:26f0f32e…`), 168 tables, 375 rows.

---

## 1. What runs

```sh
pnpm migration:groups                       # the 12 groups and their tables
pnpm migration:ddl                          # print the staging DDL the manifest implies
pnpm migration:load  <dump.sql|.sql.gz>     # stage one dump, record per-table checksums
pnpm migration:run   <dump.sql> [--groups]  # load, transform, parity, report
pnpm migration:rehearse [fixture.sql]       # two passes over the fixture, writes reports/
```

`migration:load` reads through `DumpSource` (tokenizer) or `MysqlSource` (restored MySQL); both
produce the same all-text `SourceTable`, and `scripts/import/source/differential.test.ts` proves it
against a real MySQL 5.7 by comparing row hashes for the same literals.

## 2. Layout

| Path | What it is |
|---|---|
| `scripts/import/manifest.ts` | The 12 groups, 164 migrated tables, 6 dated duplicates, 11 out-of-scope tables with reasons. `dispositionFor()` answers for every one of the 175 legacy tables. |
| `scripts/import/legacy-schema.json` | Generated from `green-system/schema.sql`: 175 tables, columns, types, primary keys. |
| `scripts/import/source/` | Tokenizer, `DumpSource`, `MysqlSource`, differential test. |
| `scripts/import/fixture/generate.ts` | Deterministic generator for the synthetic dump and its manifest. |
| `scripts/import/runner.ts` | Loader (staging + checksums) and transform runner (batch transaction, advisory lock per entity, savepoint per row, checkpoint per batch, batch rollback then row-by-row retry). |
| `scripts/import/groups/*.ts` | One transformer per group: `transform`, `unmapped`, `parity`. |
| `scripts/import/helper(s).ts`, `types.ts` | Field rules (§2.6) and the transform contract. |
| `scripts/import/users.ts` | Cohort planner over staged users, hashed invitations, legacy-MD5 bridge state machine. |
| `scripts/import/parity.ts` | Anchors as SQL, staging scoped to one dump, new side as a delta from a pre-import baseline. |
| `scripts/import/reports.ts` | `run.json/md`, `exceptions.json/md`, `parity.json/md`, expected-versus-actual per group. |
| `packages/db/drizzle/0015…`, `0016…`, `0017…` | `migration` control schema, first 98 staging tables, idempotent expansion to all 164. |

## 3. Controls that matter at cutover

- **Staging is all text.** A bad legacy value lands and is reported; nothing is coerced, rejected or
  repaired at load. Each table's row count and checksum is recorded per dump in `migration.dump_objects`.
- **`row_map` is the crosswalk.** Every mapped row records source table/key → target table/key in the
  same transaction as the app row, which is what makes a natural-key upsert idempotent.
- **Checkpoints per batch, savepoint per row.** A bad row becomes one `migration.errors` row and its
  batch continues; a batch that cannot commit is retried row by row so the failure narrows to the row
  and the checkpoint still advances.
- **No destructive repair.** Known classes go to `migration.exceptions` with an owner and an action;
  the report prints every source key. An exception never blocks the batch and never deletes a row.
- **Module promotion flag.** Each group writes `migration.modules` `passed`/`needs_review`/`blocked`;
  the cutover controller can refuse a module that did not pass.

## 4. User migration

`planUserInvites` segments staged users into `unique-email`, `shared-email`, `no-email`, `disabled`,
`duplicate-username`, `orphan-vendor`, and writes one `migration.user_invites` row per legacy id. It
never reads a password column (a guard fails the suite if one is added). Invitations are 256-bit
tokens stored as hashes, single use, 72 hours. The subcontractor bridge is a pure state machine:
5 attempts / 15 minutes, lock, burn on success, refused for disabled accounts, 60-day lifetime.

## 5. Rehearsal result

See `reports/migration-<dump>/run.md` for the full run and the per-group expected-versus-actual
table, `exceptions.md` for the decision list, `parity.md` for the anchors and `idempotency.json` for
the two-pass comparison. Headline numbers:

Run of 2026-11-12 (`reports/migration-26f0f32ef0a0/`):

- 12/12 groups `passed` in the transform and settle phases, 0 row errors on both passes, and the
  verify pass changed no app row counts (`idempotency.json`): 0.0 drift.
- 371 staged rows of 371 expected; 164 tables loaded, 4 dated duplicates skipped, 0 missing.
- Every group accounts for every staged row: mapped + exceptioned rows equals staged for all 12
  groups, so no row is silently lost. 299 rows reached `app` with a crosswalk entry; 141 exceptions
  in 20 classes, each with an owner (finance, operations, admin, data platform).
- Parity: 62 anchors. 49 compare staging to `app` and all 49 match, 0 differ, 0 error. The other 13
  are the lookups and legacy-mirror anchors, marked `oldOnly` because the forward model has no table
  to compare against (the adapters read the read-only `public.*` mirror).
- User cohorts: 3 unique-email, 2 shared-email, 1 no-email, 3 disabled, 2 duplicate-username,
  1 orphan-vendor.

| # | Group | Tables | Expected | Staged | Mapped | Accounted | Mismatch |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | lookups | 11 | 44 | 44 | 44 | 44 | none |
| 2 | parties | 7 | 35 | 35 | 35 | 35 | none |
| 3 | identity | 4 | 20 | 20 | 16 | 20 | none |
| 4 | parts | 12 | 34 | 34 | 34 | 34 | none |
| 5 | compliance | 5 | 14 | 14 | 12 | 14 | none |
| 6 | work-orders | 24 | 55 | 55 | 43 | 55 | none |
| 7 | quotes | 28 | 32 | 32 | 24 | 32 | none |
| 8 | purchasing | 20 | 44 | 44 | 43 | 44 | none |
| 9 | inventory | 7 | 22 | 22 | 7 | 22 | none |
| 10 | invoicing-rga | 12 | 33 | 33 | 21 | 33 | none |
| 11 | tjx | 23 | 15 | 15 | 6 | 15 | none |
| 12 | messaging-history | 11 | 23 | 23 | 14 | 23 | none |

## 6. Known gaps

1. The fixture carries rows for the 98 tables the manifest started with; the 66 tables classified
   later are staged with zero rows and have no column map yet. A real dump will hit them, so they are
   a cutover blocker until mapped.
2. `public.*` legacy mirror tables are not loaded by this harness, so the lookups anchors count staged
   rows (`oldOnly`) instead of comparing to the mirror.
3. Eleven tables are deliberately out of scope; every reason is in `coverage.md`.
4. The legacy dump is latin1; the tokenizer decodes once and a test pins ISO-8859-1 semantics
   (`0x80` is not `€`).
5. The fixture fills `messages.sender`/`receiver` from a generic word pool, not usernames, and
   `app.messages.author_user_id` is NOT NULL, so the message rows are exceptioned (`orphan_line`)
   rather than inserted. The real dump uses `$user_login`, so this is a fixture gap, not a
   transformer defect; the anchors count attributable messages and the live dump will exercise them.

## 7. Client ask

`plan/CLIENT-DUMP-CHECKLIST.md`: the exact `mysqldump` command, where to put the file, what runs on
receipt, and the eight decisions the migration cannot make alone.
