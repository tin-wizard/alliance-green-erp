# Parity notes

Read this beside `reports/migration-<dump>/parity.md`. Every anchor changed while
triaging the rehearsal differences is listed here with (a) what its new side
measures, (b) which recorded exception class explains the legacy rows the old side
does not count, and (c) any money rows excluded. No anchor was made to pass by
comparing staging to staging, by hard-coding an expected result, or by loosening a
money anchor to a count.

## How the new side is measured

`runParity` subtracts a baseline captured before the import, so a new-side value
normally means "what this dump added". That is correct for rows the rehearsal
reset can delete, because they have a surrogate `id` recorded in
`migration.row_map`. It is wrong for tables where the reset cannot delete an
earlier run's rows:

- `app.shared_parts` has no `id`;
- `app.user_permissions` has no `id` (one row per `user_id, permission_key`).

Those anchors read the rows this import owns through a `migration.row_map` join
instead of a delta over the whole table. The baseline of an empty `row_map` is
zero rows, so the delta is the absolute count for this dump on a fresh target and
on a rerun alike.

Money anchors stay `sum(...)::numeric` over the migrated rows; the rows excluded
are named per anchor below.

## Anchor changes

| Group | Anchor | Old side now counts | Exception class relied on |
|---|---|---|---|
| parties | sites | unchanged (8 staged) | — (crosswalk new side) |
| parties | sites without a billing customer | unchanged (2 staged) | — (crosswalk new side) |
| parties | subcontractors | unchanged (5 staged) | — (crosswalk new side) |
| identity | users (one per username) | unchanged (11 staged) | — (crosswalk new side) |
| identity | user permission grants (named + price management) | grants whose user was migrated and whose name is in the app registry, plus price-editor grants for migrated users | `duplicate_username`, `orphan_line` |
| parts | shared part mappings | unchanged (3 staged) | — (crosswalk new side) |
| work-orders | work orders by status | staged work orders excluding placeholder ids | `placeholder_work_order` |
| work-orders | work-order parts money | lines whose parent work order is inserted | `orphan_line` (and `placeholder_work_order` for placeholder parents) |
| work-orders | work-order labour hours | unchanged (crosswalk new side) | — |
| quotes | quote headers (customer + standalone) | unchanged (8 staged) | — (crosswalk new side) |
| inventory | sale movements: total quantity | `transaction_type = 'sale'` rows with a part number | `unresolved_part_line` |
| invoicing-rga | posted invoice totals (parseable rows only) | plain-numeric posted totals for inserted work orders | `blank_money`, `unparseable_money`, `orphan_line`, `placeholder_work_order` |
| invoicing-rga | invoices: one per work order with a posted snapshot | distinct `inv_tax` woids whose work order was inserted | `orphan_line`, `placeholder_work_order` |
| invoicing-rga | invoice part lines: total amount | lines whose `woid` is an inserted work order | `orphan_line`, `blank_money`, `unresolved_part_line` |
| invoicing-rga | RGA part lines: row count | parts of RGAs whose status is in the legacy lookup | `unknown_enum` |
| tjx | quotes: row count | quotes whose status is in the measured 1/3/4/5 vocabulary | `unknown_enum` |
| tjx | quotes: posted total amount | same quote scope, summed | `unknown_enum` |
| tjx | quote revisions kept as snapshots | revisions whose quote was inserted | `orphan_line` |
| tjx | subcontractor invoices: total amount | invoices whose quote was inserted | `orphan_line` |
| messaging-history | messages kept | messages whose sender resolves to a staged username/e-mail | `orphan_line` |
| messaging-history | message body characters preserved | same message scope, summed | `orphan_line` |
| messaging-history | RGA reminder notifications kept | reminders whose RGA was inserted | `orphan_line` (underlying `unknown_enum`) |

## Per-anchor detail

### parties, identity users, quotes — parent rows kept by the reset

An earlier rehearsal's parent rows (`app.sites`, `app.subcontractors`,
`app.users`, `app.quotes`) can survive the rehearsal reset because a child row
still references them. A whole-table count then sees them in the baseline and a
delta silently deducts them from this dump's rows. These four anchors now count
this import's rows through `migration.row_map` (`site`, `subcontractor`, `user`,
`quote`), so the new side is absolute for this dump. The old side is unchanged:
the same staged rows that were always counted.

### invoicing-rga — invoices with a posted snapshot

The anchor previously compared `count(distinct inv_tax.woid)` (6) with
`count(*) from app.sales_invoices` (6). The two sets were not the same rows: two
`inv_tax` woids are a placeholder/orphan and never get an invoice, and two
invoices are built only from `inv_*` lines and have no posted snapshot. The
counts matched by coincidence. The old side now excludes placeholder/orphan
woids and the new side counts posted-snapshot crosswalk rows, which is what the
label says: 4 and 4 on this dump.

### identity — user permission grants

The old side now counts a grant only when its legacy user was actually migrated
and its `permission_name` maps to an app key:

- the second `jsmith` row is quarantined (`duplicate_username`, owner admin), so
  its two grants are not app grants;
- a grant with `user_id` NULL has no app user (`orphan_line`, owner module owner).

The transformer also gained the explicit legacy-vocabulary map
(`workorders.view` → `workorder:read`, `workorders.edit` → `workorder:write`,
`quotes.edit` → `quote:write`, `purchasing.approve` → `purchasing:approve`,
`reports.view` → `reports:read`, `users.admin` → `admin:users`). Before that map
every dotted legacy name was discarded as `unknown_enum` even though the app has
the corresponding key. A name outside the map is still reported, never guessed.
The raw legacy name stays in `user_permissions.note`.

### parts — shared part mappings

`app.shared_parts` stores only `(part_code, main_part_code)`, so the rehearsal
reset cannot delete the rows a previous run wrote. The new side joins
`migration.row_map` on `entity = 'shared_part'`. Old 3, new 3.

### work-orders — work orders by status and parts money

`placeholder_work_order` (owner business owner) is a policy skip: ids
`0, 9999998, 9999999, 44444444, 99999999` are operator markers and are never
inserted. The histogram and the parts sum therefore exclude them.

A `wo_parts` row whose `woid` has no `stg_workorder` parent is not inserted
(`orphan_line`: `work_order_id` is NOT NULL and no parent is invented). Those
four lines, including their prices, are outside the anchor. Money rows excluded:
only those orphan lines; every inserted line's `price` is summed as posted (a
blank price stays NULL and contributes nothing, as before).

### inventory — sale movements

A movement with a blank `partno` cannot be written (`part_no` is NOT NULL) and is
recorded as `unresolved_part_line`; it is excluded from the old sum. The staged
sale row that remains has a blank part number, so the expected quantity is 0.

### invoicing-rga — posted invoice totals

"Parseable" keeps the spec's definition (`inv_tax.total_amount` matching
`^-?[0-9]+(\.[0-9]{1,4})?$`), so formatted values such as `$113.00`, blank
values and `n/a` are outside the anchor. Rows whose work order is a placeholder
or missing are also outside it (`placeholder_work_order`, `orphan_line`).

The new side sums `app.sales_invoices.total_amount` for invoices that have a
posted snapshot in the crosswalk, and only where that snapshot's staged total is
parseable. The value itself is read back from `app`, so this still proves the
posted number was stored unchanged; the crosswalk only declares the row set. An
invoice built from lines without a posted snapshot (1005, 1006) is not "posted"
and is not counted.

### invoicing-rga — invoice part lines

A line whose `woid` does not resolve to an inserted work order is
`orphan_line` and is not written. `applied_woid` is a reference column and does
not decide insertion. Money rows excluded: only the orphan line; a line with a
blank part number, quantity or price would be `unresolved_part_line` /
`blank_money`, and none of the inserted lines has one.

### invoicing-rga — RGA part lines

`STATUS-VOCABULARY` §4.1 measures exactly 2/3/4/6/7/10/11 for `rga.status`; codes
1, 5, 8 and 9 do not exist in the lookup and must never be emitted. Status 1 in
the synthetic row has no app code, so the RGA is not inserted (`unknown_enum`,
owner module owner) and its part line is `orphan_line`. The anchor counts parts
of RGAs the migration can insert.

### tjx — quotes, revisions and subcontractor invoices

The measured `tjx_quote.status` vocabulary is 1/3/4/5 (`STATUS-VOCABULARY` §6).
Status 2 has no app code (the app check list is the same four), so the quote is
reported as `unknown_enum` and not inserted. The quote count and posted total
therefore use the 1/3/4/5 scope.

A revision whose `quoteid` did not become an app quote is `orphan_line`
(`quote_id` is NOT NULL), and so is a subcontractor invoice whose `quoteid` did
not resolve. No money row is dropped for any other reason: the sub-invoice anchor
sums the inserted headers as posted (the one inserted header posted `0.00`, which
is what the legacy row says).

### messaging-history — messages and RGA reminders

`app.messages.author_user_id` is NOT NULL. The transformer refuses to invent an
author, so a message whose `sender` is not a migrated username/e-mail is reported
as `orphan_line` and not inserted (this is unit-tested). The old side counts only
attributable messages, which keeps the body-length anchor honest for the rows the
migration actually promises to keep.

The synthetic fixture is the reason this anchor is zero on it: the fixture
generator fills `messages.sender` and `messages.receiver` from its generic
`SHORT_WORDS` pool (`Standard`, `Interior`, `North`, …), not from usernames. In
the real database `messages.receiver = $user_login` (`app/messaging.php:35`), so
the anchor is exercised on the live dump. This is a fixture gap, not a
transformer defect; the rows are visible in `migration.exceptions` and are not
hidden.

An RGA reminder names its RGA; RGA 1 has the invalid status 1, so the RGA is
`unknown_enum` and the reminder is `orphan_line`. The anchor counts reminders
whose RGA the migration can insert.
