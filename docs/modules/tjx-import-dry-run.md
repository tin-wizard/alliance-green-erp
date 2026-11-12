# TJX import dry run

Run on 2026-11-12 against the production database with:

```bash
set -a && . ./.env && set +a
pnpm exec tsx scripts/import/tjx.ts --dry-run
```

## Result

```json
{
  "dryRun": true,
  "counts": {
    "rooms": 0,
    "fixtures": 0,
    "fixtureParts": 0,
    "rates": 0,
    "quotes": 0,
    "quoteFixtures": 0,
    "quoteParts": 0,
    "quoteSpecials": 0,
    "revisions": 0
  },
  "imported": {},
  "skipped": {},
  "missing": [
    "No legacy quote headers are present. Quote, fixture, part and revision history is unrecoverable without a live mysqldump; nothing was synthesized."
  ],
  "revisionFailures": [],
  "warnings": []
}
```

The `public.tjx_*` mirror holds no TJX rows in this database, including the
1,712 quote-part and 6,964 price rows the archive report described. The import
therefore has nothing to write, and quote history remains unrecoverable until a
live `mysqldump` is loaded into the mirror.

The script is idempotent by `legacy_id`; `--replace` deletes and re-imports an
existing legacy quote; `--dry-run` reads only and never writes. Revision
payloads go through `parsePhpSerialized`; failures are stored as `{ "_raw": ... }`
and listed by revision id rather than dropped.
