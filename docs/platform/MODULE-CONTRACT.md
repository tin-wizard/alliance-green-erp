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

  await writeAudit(tx, { action: 'workorder.complete', permission: 'workorder:approve', /* actor, entity, before/after */ })
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

Two key shapes exist, and both are exact strings:

- `module:action` for broad CRUD (`workorder:write`, `invoice:issue`).
- dotted keys for the seven gates inherited from legacy username checks
  (`invoice.calculate`, `invoice.post_sage`, `po.approve`, `po.issue`,
  `report.download_rates`, `pma.certificate.download`,
  `subcontractor.rates.download`). Copy the string from `PERMISSIONS`; do not
  invent a colon variant.

Never hardcode a role name in a guard (`role === 'admin'`). Use a permission. A
role check is allowed only to narrow data the permission already allows, such as
"a subcontractor sees only their own vendor"; document it and test it.

When a sensitive action writes audit, pass `permission: '<key>'` so the record
names the capability, not a person (`AUTH-RBAC.md` §8).

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
- **Authorization denial tests** for every guarded server function. See §8.1.
- **E2E** for the primary flow: list → open → edit → save, plus one permission
  denial (a user without the key gets 403/redirect).
- **Data reconciliation** where the module replaces a legacy calculation: a
  fixture with legacy input and expected output, proving parity. This is the
  cutover gate, not optional.

Test the states no happy path covers: empty list, cancelled/void records,
concurrent update (409), expired compliance document, decimal money rounding.

### 8.1 Proving a server function denies the wrong caller

Every guarded server function needs three denial cases, not just the happy path:

| Case | Caller | Expected |
|---|---|---|
| Unauthenticated | no `cls_session` cookie | `401` (server function) or redirect to `/login` (route) |
| Wrong role | signed in, role lacks the key | `403` with the permission key, audited `auth.permission_denied` |
| Wrong scope / company | signed in, key is scoped or data belongs to another vendor | `403` or `404`; never another vendor's row |

Write the authorization decision so it can be tested without a browser. Pass the
session into the server implementation; do not read it from a global inside the
query:

```ts
// list.server.ts
import { assertPermission, assertScopedPermission } from '../../../server/middleware'
import type { AuthSessionView } from '../../../server/auth.types'

export async function queryWorkOrders(
  input: { page: number; subcontractorId?: number },
  session: AuthSessionView,
) {
  assertPermission(session, 'workorder:read')
  // A technician or subcontractor is always narrowed to their own vendor; the
  // client cannot widen it by sending another id.
  if (session.user.role === 'subcontractor') {
    assertScopedPermission(session, 'workorder:read', session.user.subcontractorId ?? -1)
  }
  // ...
}
```

A unit test then fabricates the session and asserts the throw:

```ts
import { ForbiddenError } from '@cls/core'
import { assertPermission, assertScopedPermission } from '../../../server/middleware'

const technician = makeSession({ role: 'technician' })

it('denies invoice calculation to a technician', () => {
  expect(() => assertPermission(technician, 'invoice.calculate')).toThrow(ForbiddenError)
})

it('denies a scoped grant for another vendor', () => {
  const scoped = makeSession({
    role: 'subcontractor',
    subcontractorId: 42,
    grants: [{ key: 'workorder:read', scopeSubcontractorId: 42 }],
  })
  expect(() => assertScopedPermission(scoped, 'workorder:read', 43)).toThrow(ForbiddenError)
})
```

`makeSession` is a local test factory that fills `AuthSessionView` with defaults
and lets each test override role, `subcontractorId` and `grants`. Do not sign in
for these tests; they are pure and fast.

For the middleware wiring itself, test the end-to-end denial once per module
(§8.2). The unit test proves the rule; the E2E proves the rule is attached to the
function.

### 8.2 A throwaway signed-in session for integration tests

Never reuse a real person's login, and never commit a password. Provision a
throwaway through the provider admin API, give it an app role, use it, delete it.

```ts
// e2e/support/throwaway.ts (test process only; never imported by the app)
const BASE = process.env.NEON_AUTH_BASE_URL!
const ORIGIN = process.env.APP_URL!

async function adminCookie(): Promise<string> {
  const response = await fetch(`${BASE}/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({
      email: process.env.E2E_ADMIN_EMAIL,
      password: process.env.E2E_ADMIN_PASSWORD,
    }),
  })
  if (!response.ok) throw new Error(`admin sign-in failed: ${response.status}`)
  return response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

export async function createThrowaway(email: string, password: string) {
  const cookie = await adminCookie()
  const response = await fetch(`${BASE}/admin/create-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
    body: JSON.stringify({ email, password, name: 'E2E Throwaway' }),
  })
  if (!response.ok) throw new Error(`create-user failed: ${response.status}`)
  return (await response.json()).user as { id: string; email: string }
}

export async function deleteThrowaway(userId: string) {
  const cookie = await adminCookie()
  await fetch(`${BASE}/admin/remove-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
    body: JSON.stringify({ userId }),
  })
}
```

Insert the app row with the role under test, sign in once through the real login
page, then use the page or its request context:

```ts
const email = `e2e-${Date.now()}@example.invalid`
const password = randomBytes(24).toString('base64url')
const authUser = await createThrowaway(email, password)

await sql`
  insert into app.users (email, username, display_name, role)
  values (${email}, ${'e2e' + Date.now()}, 'E2E Throwaway', 'technician')
`

await page.goto('/login')
await page.getByLabel('Username or email').fill(email)
await page.getByLabel('Password').fill(password)
await page.getByRole('button', { name: 'Sign in' }).click()
await expect(page).toHaveURL(/\/$/)

// Drive the real UI: it exercises the route, the server function and the
// middleware together. Server-function RPC ids are build-generated, so do not
// hard-code a /_serverFn/... URL in a test.
await page.goto('/work-orders/<id>')
await page.getByRole('button', { name: 'Approve' }).click()
await expect(page.getByRole('alert')).toContainText(/permission/i)

await sql`delete from app.users where email = ${email}`
await deleteThrowaway(authUser.id)
```

Use `test.afterEach` or `try/finally` so cleanup runs even when an assertion
fails. The throwaway is worthless after the run; deleting it keeps the branch
clean and prevents an accumulating list of test identities.

Rules:

- Use `@example.invalid` addresses and a random password per run.
- Create the provider user **before** the app row; delete the app row **before**
  the provider user.
- If you need a cookie without a browser, the sealed payload is
  `sealSession(SESSION_SECRET, { cookie, jwt, expiresAt })` from `@cls/auth`;
  set it as `cls_session`, `HttpOnly`, `SameSite=Lax`. The JWT must come from a
  real provider sign-in, never be minted locally.
- A throwaway with no `app.users` row must get `403` on sign-in (`not
  provisioned`); assert that too when you touch provisioning.
- Never give a throwaway `admin` unless the test is specifically proving an admin
  path, and never run these against a branch with real users.

### 8.3 Audit assertion

A denial must leave evidence of the capability, not just a username. After the
403, assert the row:

```sql
select actor_label, after->>'permission' as permission
  from app.audit_log
 where action = 'auth.permission_denied'
 order by id desc
 limit 1;
-- permission = workorder:write (or the key under test)
```

Business actions that depend on a sensitive permission must write their own
audit row with `permission: '<key>'` (§AUTH-RBAC.md §8), so the financial
decision is attributable to a capability.

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
