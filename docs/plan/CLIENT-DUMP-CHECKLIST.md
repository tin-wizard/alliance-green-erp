# What we need from the client to migrate

One page. Everything below is a block on the migration until it arrives.

## 1. The dump

Run this against the live database, from a machine that can reach it, on a quiet
day (no month-end close in progress):

```sh
mysqldump \
  --host=<live-db-host> --user=<dump-user> --password \
  --single-transaction --quick --skip-add-locks \
  --routines --triggers --events \
  --default-character-set=latin1 --hex-blob \
  --no-tablespaces --set-gtid-purged=OFF \
  <app-schema> > alliance_db_$(date +%F).sql
```

Then:

```sh
wc -l alliance_db_$(date +%F).sql
shasum -a 256 alliance_db_$(date +%F).sql   # or sha256sum on Linux
gzip -9 alliance_db_$(date +%F).sql
```

Notes that matter:

- `--single-transaction` gives one consistent snapshot of the InnoDB tables. Without
  it, a PO edited mid-dump produces rows that never existed together.
- `--default-character-set=latin1` is deliberate. The data is latin1; converting on
  extraction is a one-way door, so we convert once, in the loader, where it can be
  verified against known accents.
- `<app-schema>` is the schema that holds all 175 tables. If the live database splits
  them across schemas, send each schema as its own dump with the same flags. Eleven of
  the 175 are deliberate exclusions (settings and ServiceChannel credentials, write-only
  webhook/error logs, and three unreferenced `rga_invoice*` copies); the other 164 carry
  data the new system needs.
- If a single file is impractical, the same header followed by `--tables` and the
  table-group lists in `DATA-RECOVERY.md` §3 works. Keep one date per run; never mix
  a snapshot with a later live table.

## 2. Where to put it

Upload the `.sql.gz` and its `.sha256` to the migration bucket, prefix
`dumps/<YYYY-MM-DD>/`. Do not email it, and do not put it in a shared drive.

Tell us the date, the schema name, and the MySQL server version (`select version()`).
The dump id is the sha256 of the file; every report we produce is named after it.

## 3. What we do the moment it lands

1. Record the dump id and verify the checksum against the one you sent.
2. Load every authoritative table into the `migration` staging schema as text:
   no coercion, no rejection. Per-table row counts and checksums are recorded in
   `migration.dump_objects` so "the dump was short 77 tables" is a query, not a
   recollection.
3. Compare the 164 migrated tables against the manifest and list any table that is
   missing or short. A missing table blocks its module; it does not stop the rest.
4. Run the migrate for the modules whose data is complete, then run the parity
   anchors and produce the exception report in the purchasing shape.
5. Send you two files: `run.md` (expected versus actual per group, every mismatch
   classified) and `exceptions.md` (every exception class with an owner and the
   source keys).
6. Nothing is enabled in production and no customer sees a number until the
   decision screen has a decision for every exception that changes a financial
   total, a customer identity or a compliance state.

## 4. What we will not do without you

These are the decisions the migration cannot make on its own:

| Decision | Owner | Blocking |
|---|---|---|
| Placeholder work orders (99999999, 44444444, 9999999, 9999998, 0): delete, archive, or import flagged | Business owner | Work-order module |
| 1,086 sites with no billing customer: import from Sage or accept orphans | Operations | Customer/site module |
| 24,452 blank `inv_tax` rows: backfill from Sage or leave blank | Accounting | Invoice module |
| 110 `wo_parts.partno = '---'` lines: map to a special part or discard with sign-off | Operations | Parts/work orders |
| Two duplicate usernames: which row is canonical | Admin | Login |
| 278 disabled users: confirm any reactivations | Admin | Login |
| 339 subcontractor accounts: approve the active list and the shared-mailbox handling | Admin + operations | Subcontractor login |
| `po_status_v2` and the dated backups: confirm archive-only | Data platform | Report scope |

## 5. One more thing: the credential window

The dump contains legacy MD5 password hashes. They are not migrated and never enter
the new database. For active subcontractor field staff we keep a frozen snapshot,
reachable only over a private connection, for a 60-day bridge; after that, or when
the active list is complete, it is destroyed. If you would rather not keep the
hashes at all, say so and every account takes the forced-reset path — the trade-off
is that some field staff will need the office to walk them through onboarding.
