# Modules

Each directory here is one business module. A module owns its UI, server
functions, pure rules, tests and navigation entry. The database table slice lives
in `packages/db/src/schema/<domain>.ts`.

Read `docs/platform/MODULE-CONTRACT.md` before adding one. In short:

```
<module>/
├─ README.md
├─ nav.ts                 exported ModuleNav (discovered by glob; no central edit)
├─ types.ts               client-safe types
├─ components/            UI
├─ lib/                   pure rules + colocated *.test.ts
└─ server/
   ├─ <name>.functions.ts createServerFn wrappers (client-safe)
   └─ <name>.server.ts    server-only implementation (db, files, external IO)
```

Routes live in `apps/web/src/routes/_app/<module>/` and stay thin.

The shell discovers navigation with:

```ts
import.meta.glob('../modules/*/nav.ts', { eager: true })
```

so adding a module never edits a shared file. The only shared edit is appending a
permission key to `packages/core/src/permissions.ts`.

Work Orders is the reference implementation and lands first.
