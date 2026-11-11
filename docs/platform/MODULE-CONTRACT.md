# Module Contract

**Audience:** every agent or developer building a business module.
**Reference implementation:** Work Orders (the first module) must follow this
exactly and becomes the example others copy.

A module is one vertical slice. It owns its routes, UI, server functions, domain
logic, tests, database tables and navigation entry. It does not reach into another
module's internals.

---

## 1. Non-negotiable rules

1. **Server functions are the data boundary.** Every read or write of private
   data is a server function with `authMiddleware` or
   `permissionMiddleware('<key>')`.
2. **No server-only import at module scope in a client-reachable file.** The
   implementation lives in `*.server.ts` and is imported inside the handler with
   `await import()`. See §5 and `DATA-LAYER.md` §9.
3. **All writes are transactional and audited.** `writeAudit(tx, …)` in the same
   transaction as the business change.
4. **No shared-file edits for registration.** Routes are files; navigation is
   discovered by glob. The only shared edit allowed is adding permission keys to
   `packages/core/src/permissions.ts` (append-only).
5. **One app schema file per domain.** A module edits its own
   `packages/db/src/schema/app.ts` slice (split into `app/<domain>.ts` when it
   grows) and nothing else in `packages/db`. The `schema/legacy/*` mirror is
   generated from the contract and must never be hand-edited.
6. **Status values come from `@cls/core`.** No local status strings.
7. **Business rules are pure functions in `lib/`, unit-tested.** Components and
   server functions orchestrate; they do not contain the rule.
8. **The build must stay green.** Typecheck, lint, unit tests, build and E2E pass
   before hand-off.

---

## 2. Directory layout

```
apps/web/src/modules/<module>/
├─ README.md                 what this module does, screens, rules, parity notes
├─ nav.ts                    navigation registration (exported, no central edit)
├─ components/               module UI only
├─ lib/                      pure domain logic + *.test.ts colocated
├─ server/
│  ├─ <name>.functions.ts    createServerFn wrappers (client-safe)
│  └─ <name>.server.ts       server-only implementation (db, files, external IO)
└─ types.ts                  module-local types (client-safe)

apps/web/src/routes/_app/<module>/
├─ route.tsx                 list / index screen
├─ $id.tsx                   detail screen (or nested folder)
└─ ...                       file-based routes only; thin, delegate to components/

packages/db/src/schema/app.ts            this module's forward-model tables (split when large)
packages/db/src/schema/legacy/*.ts       generated contract mirror — read-only
```

Route files are thin. They validate search params, run `beforeLoad` guards, and
render a component from `modules/<module>/components`. They do not contain
business logic or SQL.

---

## 3. Navigation registration

Create `apps/web/src/modules/<module>/nav.ts`:

```ts
import { ClipboardList } from 'lucide-react'
import type { ModuleNav } from '../../shell/navigation'

export const nav: ModuleNav = {
  group: 'Operations',          // Overview | Operations | Supply | Finance | Network | Admin
  order: 10,                    // lower first inside the group
  items: [
    {
      label: 'Work orders',
      to: '/work-orders',
      icon: ClipboardList,
      permission: 'workorder:read',
      // badge: count that needs attention, never a total
    },
  ],
}
```

Rules:

- `to` must match a real route file. The registry is data; broken links are a
  bug.
- Every item needs a `permission` unless it is truly unrestricted for signed-in
  users.
- Do not edit `apps/web/src/shell/navigation.ts`. The glob picks up your file.
- A module may export an array of `ModuleNav` when it spans two groups.

---

## 4. Route guard (UX)

```tsx
// apps/web/src/routes/_app/work-orders/route.tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../server/auth.functions'
import { WorkOrderList } from '../../../modules/work-orders/components/work-order-list'

export const Route = createFileRoute('/_app/work-orders/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/work-orders' } })
    if (!session.user.grants.some((g) => g.key === 'workorder:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: WorkOrderList,
})
```

`beforeLoad` is UX only. The list component calls the guarded server function.

---

## 5. Server functions and server-only code

### 5.1 The pair

`modules/work-orders/server/list.functions.ts` — client-safe:

```ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { permissionMiddleware } from '../../../server/middleware'
import type { WorkOrderListResult } from '../types'

const input = z.object({
  page: z.number().int().min(1).default(1),
  status: z.enum(['draft', 'pending', 'progress', 'complete', 'cancelled']).optional(),
})

export const listWorkOrders = createServerFn({ method: 'GET' })
  .validator((data: unknown) => input.parse(data))
  .middleware([permissionMiddleware('workorder:read')])
  .handler(async ({ data }): Promise<WorkOrderListResult> => {
    const { queryWorkOrders } = await import('./list.server')
    return queryWorkOrders(data)
  })
```

`modules/work-orders/server/list.server.ts` — server only:

```ts
import { and, eq } from 'drizzle-orm'
import { getDb } from '@cls/db'
import { workOrders } from '@cls/db/schema'
import type { WorkOrderListResult } from '../types'

export async function queryWorkOrders(input: {
  page: number
  status?: string
}): Promise<WorkOrderListResult> {
  const db = getDb()
  const rows = await db
    .select({ /* explicit columns */ })
    .from(workOrders)
    .where(input.status ? eq(workOrders.status, input.status) : and())
    .orderBy(workOrders.createdAt)
    .limit(50)
    .offset((input.page - 1) * 50)
  return { rows, page: input.page }
}
```

Why the dynamic import: the Start compiler replaces handler bodies in the client
bundle but keeps module-scope imports. A static `import { queryWorkOrders }` in
the `.functions.ts` file would drag `@cls/db` into the browser. The build's import
protection enforces this (`*.server.*` cannot be imported from client code).

### 5.2 Writes

```ts
export const completeWorkOrder = createServerFn({ method: 'POST' })
  .validator((data: unknown) => completeInput.parse(data))
  .middleware([permissionMiddleware('workorder:approve')])
  .handler(async ({ data }) => {
    const { complete } = await import('./complete.server')
    return complete(data)
  })
```

In `complete.server.ts`:

```ts
const db = getDb()
return db.transaction(async (tx) => {
  const [updated] = await tx
    .update(workOrders)
    .set({ status: 'complete', completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(workOrders.id, id), eq(workOrders.status, 'progress')))
    .returning()

  if (!updated) throw new ConflictError('Work order changed since you loaded it.')

  await writeAudit(tx, { action: 'workorder.complete', /* actor, entity, before/after */ })
  return updated
})
```

- Conditional `where` + `returning()` prevents lost updates.
- Do not trust the client for the current status, totals or actor identity.
- Scope checks for subcontractors happen in the handler, not the UI.

---

## 6. Schema slices: app model vs legacy mirror

The database has two layers (see `DATA-LAYER.md`):

- **`public` legacy mirror** — 171 of the 175 contract tables, exact MySQL names and columns,
  generated from `packages/db/contract/schema.json`. Use `legacyX` exports (`legacyWorkorder`,
  `legacyUsers`, …) for migration reads and reconciliation. **Never edit these files.**
- **`app` schema** — the forward model you build. Add tables to `packages/db/src/schema/app.ts`
  (or a new `app/<domain>.ts` re-exported from `app.ts` when the file grows). Names are
  `snake_case`; money is `numeric(12,2)`, timestamps are `timestamptz`, ids are `uuid`.

Rules:

- Do not create foreign keys against the legacy mirror.
- Do not write to legacy tables from a new module. If legacy still owns the data during
  transition, read it through the mirror and write through a documented dual-write/outbox path
  owned by the Sage or migration module.
- Do not duplicate a legacy table in `app` just to change a name. Build the app table only when
  the module's model is deliberately different, and document the mapping.
- Add the table, generate the migration, read the SQL, apply it, commit both.
- The legacy mirror is regenerated with `pnpm db:generate:schema`; update the contract first.

Cross-domain foreign keys are allowed inside `app`. Cross-domain writes are not.

---

## 7. Permissions

1. Append keys to `PERMISSIONS` in `packages/core/src/permissions.ts`.
2. `pnpm db:seed` to write the catalogue and role defaults.
3. Guard the server function.
4. Add the key to `nav.ts` items that need it.
5. If the permission is scoped (like the WSIB override), add a
   `scope_subcontractor_id` row via the admin flow and use
   `assertScopedPermission`.

Never hardcode a role name in a guard (`role === 'admin'`). Use a permission.

---

## 8. Tests

Before hand-off:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Required:

- **Unit tests** for every pure rule in `lib/`: totals, tax, status transitions,
  eligibility, numbering, validators. Colocate as `lib/<name>.test.ts`.
- **E2E** for the primary flow: list → open → edit → save, plus one permission
  denial (a user without the key gets 403/redirect).
- **Data reconciliation** where the module replaces a legacy calculation: a
  fixture with legacy input and expected output, proving parity. This is the
  cutover gate, not optional.

Test the states no happy path covers: empty list, cancelled/void records,
concurrent update (409), expired compliance document, decimal money rounding.

---

## 9. Status vocabulary

Use `STATUSES` / `STATUS_LABELS` from `@cls/core` and `StatusChip` from
`apps/web/src/shell/status-chip.tsx`. The eleven values are fixed by the design
system:

`draft`, `pending`, `approved`, `ordered`, `transit`, `received`, `progress`,
`complete`, `invoiced`, `cancelled`, `rejected`.

If a module needs a state that is not in the set, it is either a sub-state
(detail on the record) or a design-system change. Do not invent strings.

Allowed transitions are the module's business rule: implement them as a pure
function and unit-test them.

---

## 10. Definition of done

- [ ] Screens exist at the routes in `nav.ts`, with the shell layout and page
      header pattern.
- [ ] List screen: server-side pagination, sorting, filters, empty/loading/error
      states, bounded query.
- [ ] Detail screen: all fields the legacy screen exposed, plus audit metadata.
- [ ] Every data access is a guarded server function; no SQL in components.
- [ ] Writes are transactional and audited; conflicts return 409.
- [ ] Permissions added, seeded, and enforced; denial E2E covers one.
- [ ] Schema slice migrated; SQL reviewed; no edits to the shared registry beyond
      the domain file.
- [ ] Unit tests for rules; E2E for the main flow.
- [ ] `README.md` in the module: purpose, screens, rules, legacy parity notes,
      known gaps.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass.
- [ ] No secrets, no console noise, no `any` introduced, no server code in the
      client bundle.
- [ ] Legacy parity numbers recorded for the cutover report.

---

## 11. Do / do not

| Do | Do not |
|---|---|
| Add `nav.ts` in your module | Edit the shell's navigation array |
| Add tables to your app slice | Edit the generated legacy mirror |
| Use `legacyX` for migration reads | Write to a legacy table from a new module |
| Use `permissionMiddleware` | Check `role === 'admin'` |
| Throw `AppError` subclasses | Throw bare `Error` for expected failures |
| Import server code inside the handler | Import `@cls/db` at module scope in a route or component |
| Use `STATUSES` from core | Invent status strings |
| Write a pure rule + test | Put a calculation in a component |
| Bound list queries | Load a table into memory and filter in JS |
| Use `numeric` for money | Use `float` |
| Emit an audit row per write | Log a write only to stdout |
| Add a new migration | Edit an applied migration |
| Report honestly what is stubbed | Fake a success path |

---

## 12. Module skeleton (copy this)

```bash
mkdir -p apps/web/src/modules/work-orders/{components,lib,server}
mkdir -p apps/web/src/routes/_app/work-orders
touch apps/web/src/modules/work-orders/{README.md,nav.ts,types.ts}
```

Then:

1. Write the schema slice from `green-system/DATA-DICTIONARY.md`.
2. Add permissions.
3. Write pure rules and their tests.
4. Write `.server.ts` queries/mutations.
5. Write `.functions.ts` wrappers with middleware.
6. Write components and thin routes.
7. Add `nav.ts`.
8. Run the definition-of-done checks.
