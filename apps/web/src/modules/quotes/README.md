# Quotes

Customer and standalone quotes, from first line to work order and PDF.

`docs/plan/modules/QUOTES.md` holds the design and the decisions taken; this file
is the working map of the module.

## What lives here

```
apps/web/src/modules/quotes/
├── components/          list, create/edit form, detail (tabs: lines, revisions, rejections, packing, PDFs)
├── lib/
│   ├── status.ts        status labels, transition table, permission + error messages
│   ├── rules.ts         pricing input mapping, conversion/revision/capability rules
│   ├── validation.ts    Zod schemas for every server function
│   └── list-search.ts   URL search state and keyset cursor
├── server/
│   ├── access.server.ts     staff/permission guards, quote loading
│   ├── records.server.ts    line replacement, audit helpers
│   ├── list.server.ts       filtered list with totals
│   ├── get.server.ts        detail, lines, chain, rejections, packing slips
│   ├── create.server.ts     header validation, pricing, Work Orders number reservation
│   ├── update.server.ts     editable statuses only, version guard
│   ├── lifecycle.server.ts  transitions, reject, revise/resubmit, standalone delete
│   ├── convert.server.ts    approved quote -> Work Orders core
│   ├── pdf.server.ts        DTO mapping, storage, generated-document records
│   └── *.test.ts            unit, integration (rolled-back Neon transaction)
├── types.ts
└── README.md
```

Routes: `/quotes`, `/quotes/new`, `/quotes/$id`, `/quotes/$id/edit`.

## Money

`packages/pricing/src/quote.ts` owns the quote calculation. It is an extension of
the shared pricing package, not a copy:

- labour is `hours × numTechs × rate`;
- incurred hours/rate and cost price are parallel columns used only for margin;
- tax uses the manual amount when present, otherwise per-line accumulated rates;
- per-line rounding to two decimals.

Fixtures and contract tests: `packages/pricing/fixtures/quote.json`,
`packages/pricing/src/quote.test.ts`.

## Numbering (H4)

Customer quotes consume the Work Orders number space. At creation the module
calls the Work Orders allocator (`allocateWorkOrderNumber` +
`commitWorkOrderNumber`) and stores the result in `quotes.work_order_number`.
There is no quote counter. Approval and conversion keep that number; conversion
passes it to `createWorkOrderCore(..., { workOrderNumber })`, which is the only
place a work order row is inserted. Cancelled quotes do not return their number.

## Lifecycle

```
1 In Progress -> 2 Saved (standalone) | 3 Waiting for approval | 5 Cancelled
2 Saved       -> 1 | 3 | 5
3 Waiting     -> 4 Approved | 5 Cancelled
4 Approved    -> none (issue a revision)
5 Cancelled   -> none (resubmit through a revision)
```

The transition table, labels and error text live in `lib/status.ts`. The server
rejects illegal changes with both statuses and the legal next set, checks the
version, and audits every change. Approval needs `quote:approve` and stamps
`date_approved` in America/Toronto.

Revisions copy the header and lines into a new row with `is_revision`,
`revision_quote_id`, `root_quote_id`, `revision_id + 0.1`, clearing the previous
chain end. Rejection stores the reason and a content snapshot in
`quote_rejections` and cancels the quote; resubmission is a revision that starts
in Waiting for approval.

## Permissions

| Action | Permission |
| --- | --- |
| List, detail, PDF list/open | `quote:read` |
| Create, edit, revise, delete standalone | `quote:write` |
| Approve, reject, resubmit | `quote:approve` |
| Convert to work order | `quote:approve` + `workorder:create` |

Quotes are office-only: even roles carrying `quote:read` (subcontractor today)
are denied until a customer quote portal exists. The server guard is
authoritative; the UI only hides actions.

## PDFs and packing slips

Layout is owned by `packages/pdf` (`@cls/pdf`), per ADR 0011. This module builds
a versioned, Zod-validated DTO (`QuoteDocumentData` / `PackingSlipDocumentData`)
and calls `renderDocument`; it does not import the renderer and does not write
layout. Output is stored in the private `accounting` bucket under
`generated/<kind>/<yyyy>/<mm>/<uuid>.pdf` and recorded in
`app.generated_documents` with schema version, renderer version, SHA-256, byte
size, page count and the exact data snapshot. Regeneration reads the snapshot,
never live rows.

The node-server build copies the vendored faces to `.output/server/fonts` and
pdfkit's standard-font data beside the bundle (`apps/web/scripts/copy-pdf-fonts.mjs`);
a missing face fails the build and the renderer never falls back to Helvetica.

## Verification

```bash
pnpm exec vitest run apps/web/src/modules/quotes packages/pricing packages/pdf
pnpm build
# signed-in E2E needs E2E_ADMIN_EMAIL/PASSWORD, NEON_AUTH_BASE_URL, APP_URL,
# E2E_DATABASE_URL: see docs/platform/MODULE-CONTRACT.md §8.2
pnpm exec playwright test e2e/quotes.spec.ts
pnpm verify
```

The Playwright path covers create → submit → approve → PDF (with a live
`generated_documents` row and snapshot regeneration) → convert to a work order.
