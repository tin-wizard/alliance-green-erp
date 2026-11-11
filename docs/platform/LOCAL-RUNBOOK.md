# Local Runbook — CLS Green ERP

How to install, configure, run, upgrade and troubleshoot the ERP on the company LAN server.
Written for a Windows host (the likely case, because Sage 50 lives there) with Linux notes where
they differ.

**The app must run on the same machine as Sage 50.** The Sage adapter opens MySQL to
`127.0.0.1`, trying **13541 first**, then 13540, 13542–13544, and accepts a port only when the
`SagePort` vendor row answers.

---

## 0. What you need

| Item | Version / note |
|---|---|
| Node.js | 22.12 or newer (24 LTS tested) |
| pnpm | 12.x (`corepack enable` then `corepack prepare pnpm@12.18.0 --activate`) |
| Git | to clone and update the repo |
| Neon project | Postgres + Auth + Object Storage provisioned (AI optional) |
| Neon CLI | `neon` 2.26+ for `env pull`, auth domains and credentials |
| Sage 50 | already installed on this host; `simply` database |
| Disk | ~1 GB for node_modules and build output |
| Network | outbound HTTPS to Neon; inbound LAN access to the app port only |

No Docker is required in production.

---

## 1. First install

```bash
git clone <repo-url> C:\cls-green-erp
cd C:\cls-green-erp
pnpm install
neon env pull --file .env
```

Then edit `.env` (see §2) for `APP_URL`, `SESSION_SECRET`, the Sage credentials and the optional
bootstrap admin. Register the app origin with Neon Auth:

```bash
neon neon-auth domain add http://localhost:3000
neon neon-auth domain add http://cls-server:3000     # the LAN origin people type
```

Apply the schema and catalogue, then build:

```bash
pnpm db:migrate       # direct connection, creates app + 171 legacy tables
pnpm db:seed          # 30 permissions, 49 role grants, no business data
pnpm build
pnpm start
```

Open `http://<server-name>:3000/`. Probes:

- `http://<server-name>:3000/healthz` — process alive, no dependencies
- `http://<server-name>:3000/api/health` — per-service JSON, always 200
- `http://<server-name>:3000/api/ready` — 200 only when Postgres is reachable

### First administrator

There is no default admin. To create one:

1. Create the identity in Neon Auth (Console → Auth, or the Auth API) with an address you control.
2. Enable email verification in Neon Auth and verify that address.
3. Put the same address in `SEED_ADMIN_EMAIL` in `.env`, run `pnpm db:seed`.
4. Sign in once. The verified identity is linked to an `app.users` row with role `admin`.

`SEED_ADMIN_EMAIL` is empty by default on purpose: a default address would be claimable by anyone
who signs up with it. See `platform/AUTH-RBAC.md` §3.

---

## 2. Configuration (`.env`)

`neon env pull` writes the first group. Every value is validated at startup; invalid values stop
the process with a readable list.

| Key | Notes |
|---|---|
| `NODE_ENV` | `production` on the server |
| `HOST` | `0.0.0.0` for LAN access; `127.0.0.1` for a single-machine test |
| `PORT` | 3000 by default |
| `APP_URL` | The origin people type, e.g. `http://cls-server:3000`. **Must be a Neon Auth trusted domain.** Used for redirects and provider requests |
| `DATABASE_URL` | Neon **pooled** string (`-pooler`), `sslmode=require` |
| `DATABASE_URL_UNPOOLED` | Neon direct string; used by migrations |
| `NEON_AUTH_BASE_URL` | Auth base from `neon env pull`, ends `/neondb/auth` |
| `NEON_AUTH_JWKS_URL` | `<base>/.well-known/jwks.json` |
| `SESSION_SECRET` | 32+ random chars. Seals the app cookie; rotating it signs everyone out. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `SESSION_TTL_HOURS` | 12 by default (app cap; provider JWT is 15 min and refreshed) |
| `SESSION_COOKIE_SECURE` | `true` only behind HTTPS |
| `AWS_ENDPOINT_URL_S3` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | Neon Object Storage credential from `neon env pull` |
| `STORAGE_DRIVER` | `auto` (default), `s3`, or `local` |
| `S3_BUCKET` / `S3_ACCOUNTING_BUCKET` | `assets` / `accounting` |
| `STORAGE_LOCAL_DIR` | `.data/storage` when the local fallback is used |
| `AI_ENABLED` | `false`; inference is unfunded |
| `NEON_AI_GATEWAY_BASE_URL` / `NEON_AI_GATEWAY_TOKEN` | present from `neon env pull`; kept server-side |
| `AI_DEFAULT_MODEL` | `claude-haiku-4-5` |
| `SAGE_ENABLED` | `true` on the Sage host |
| `SAGE_HOST` / `SAGE_PORTS` | `127.0.0.1` / `13541,13540,13542,13543,13544` — legacy order, do not sort |
| `SAGE_DATABASE` | `simply` |
| `SAGE_USER` / `SAGE_PASSWORD` | **required** to verify the company through the `SagePort` sentinel |
| `SEED_ADMIN_EMAIL` | optional; a real verified address only |
| `LOG_LEVEL` | `info` in production; `debug` while diagnosing |

**Never commit `.env`.** It is gitignored. Back it up in the company password manager: Neon has
backups, the secret does not.

### 2.1 Neon

1. `neon link` / `neon checkout production` (the repo already has `.neon` for `Alliance`).
2. `neon env pull --file .env` writes both connection strings + storage/AI credentials.
3. `pnpm db:migrate`, then `pnpm db:seed`.
4. Add the app origin as an Auth trusted domain (§1).
5. If the host cannot reach 5432, check outbound firewall rules. The app uses the TCP pool by
   design (interactive transactions).

Details and verified counts: `platform/NEON.md`.

---

## 3. Running as a service on Windows

### Option A — NSSM (recommended)

```powershell
nssm install ClsGreenErp "C:\Program Files\nodejs\node.exe" "C:\cls-green-erp\scripts\start.mjs"
nssm set ClsGreenErp AppDirectory "C:\cls-green-erp"
nssm set ClsGreenErp AppStdout "C:\cls-green-erp\logs\app.log"
nssm set ClsGreenErp AppStderr "C:\cls-green-erp\logs\app.err.log"
nssm set ClsGreenErp Start SERVICE_AUTO_START
nssm start ClsGreenErp
```

The service runs `scripts/start.mjs`, which loads `.env`, sets defaults and starts the Nitro
output. It does not need a shell.

### Option B — Task Scheduler

Create a task: "At startup", run `node.exe` with argument
`C:\cls-green-erp\scripts\start.mjs`, "Start in" `C:\cls-green-erp`, run whether the user is
logged on or not.

### Firewall

Allow inbound TCP 3000 **from the local subnet only**:

```powershell
New-NetFirewallRule -DisplayName "CLS Green ERP" -Direction Inbound -Protocol TCP `
  -LocalPort 3000 -RemoteAddress 192.168.0.0/16 -Action Allow
```

Do not create a port-forward or public DNS record.

---

## 4. Running on Linux (systemd)

```ini
# /etc/systemd/system/cls-green-erp.service
[Unit]
Description=CLS Green ERP
After=network-online.target

[Service]
Type=simple
User=cls
WorkingDirectory=/opt/cls-green-erp
ExecStart=/usr/bin/node scripts/start.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cls-green-erp
journalctl -u cls-green-erp -f
```

Sage 50 does not run on Linux, so the Sage adapter reports `unreachable`. Use Linux only if Sage
is retired or proxied by another host.

---

## 5. Development loop

```bash
pnpm install
pnpm dev          # Vite dev server, HMR, http://localhost:3000
```

Before calling a change done:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e     # builds, then Playwright against the production output
```

### 5.1 A disposable local database

The schema and seed run against any Postgres 16. Auth still needs Neon, because Neon Auth is a
hosted service; without it the login page renders but sign-in fails closed.

```bash
docker run -d --name cls-green-db-dev \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=neondb \
  -p 5432:5432 postgres:16-alpine

export DATABASE_URL=postgres://postgres:test@127.0.0.1:5432/neondb?sslmode=disable
export DATABASE_URL_UNPOOLED=$DATABASE_URL
pnpm db:migrate
pnpm db:seed
```

PowerShell: use `$env:DATABASE_URL = "..."`.

### 5.2 Schema changes

```bash
pnpm db:generate:schema   # contract -> legacy Drizzle files (only after updating the contract)
pnpm db:generate          # Drizzle diff -> packages/db/drizzle/NNNN_*.sql
pnpm db:migrate           # apply with DATABASE_URL_UNPOOLED
```

Never edit an applied migration and never hand-edit `packages/db/src/schema/legacy/*.ts`.

---

## 6. Upgrades

```bash
cd C:\cls-green-erp
git pull
pnpm install
pnpm db:migrate       # apply new migrations
pnpm build
nssm restart ClsGreenErp     # or: sudo systemctl restart cls-green-erp
```

Rollback: check out the previous commit, `pnpm install`, `pnpm build`, restart. Migrations are
additive; a code rollback rarely needs a schema rollback. Never edit an applied migration.

Zero-downtime is not a goal. Announce a short maintenance window, or run the new build on a second
port and switch the firewall/service target.

---

## 7. Backups

- **Data:** Neon point-in-time restore. Verify the retention window in the console and record it
  here.
- **Objects:** Neon Object Storage branches with the data; confirm the project's backup/restore
  covers both buckets. Local fallback files are **not** backed up by Neon.
- **Config:** `.env` in the company password manager.
- **Code:** git.
- **Legacy evidence:** the archived MySQL snapshot remains the source for migration.

Test a restore once before cutover. A backup that cannot be restored is not a backup — the legacy
system taught that lesson expensively.

---

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| Process exits with "Invalid environment configuration" | The message lists each bad key. Fix `.env`, restart |
| `SESSION_SECRET is required in production` | Generate one and add it to `.env` |
| `/api/health` says `database: not_configured` | `DATABASE_URL` is empty or `.env` is not beside the repo |
| `/api/health` says `database: unavailable` | Outbound 5432 blocked, wrong host, or Neon compute waking; the probe allows 6 s |
| `/api/ready` is 503 but the page loads | Expected: readiness requires the DB; `/api/health` does not |
| `/api/health` says `auth: not_configured` | `NEON_AUTH_BASE_URL` / `NEON_AUTH_JWKS_URL` missing |
| Sign-in returns `INVALID_ORIGIN` | Add `APP_URL` as a Neon Auth trusted domain |
| Sign-in says "Invalid username or password" for a known person | The provider rejected the password. Use the Neon Auth reset flow; the app has no password store |
| Sign-in succeeds then "not provisioned" | The Neon identity has no linked `app.users` row. Invite/create it, or set `SEED_ADMIN_EMAIL` for the bootstrap admin |
| Everyone is signed out after a restart | `SESSION_SECRET` changed, or the provider session expired |
| Storage card says "Unavailable" | `AWS_*` credentials expired or the branch lineage changed; re-run `neon env pull` |
| Storage silently uses local disk | `AWS_*` values are missing and `STORAGE_DRIVER=auto`; set `s3` to fail loudly |
| AI card says "Off" | Expected: `AI_ENABLED=false`; inference also needs prepaid credits |
| Sage card says "Unreachable" | Sage is not running, or moved off 13541/13540/13542-13544 |
| Sage card says "Unverified" | `SAGE_USER` / `SAGE_PASSWORD` are missing; only a TCP listener was found |
| Sage card says "Wrong company" | A MySQL server answered but has no `tvendor` row `(663, 'SagePort')` |
| LAN machines cannot connect | `HOST=0.0.0.0`, firewall rule, and no VPN split-tunnel blocking the subnet |
| Port 3000 already in use | Set `PORT` in `.env`; the start script passes it to Nitro |

Logs: stdout/stderr JSON lines with `ts`, `level`, `msg` and fields. Secrets are redacted by key
name. Start with `grep '"level":"error"'`.

---

## 9. Security checklist for the server

- [ ] `.env` is not in git and is readable only by the service account.
- [ ] `SESSION_SECRET` is unique, 32+ characters, and backed up.
- [ ] `APP_URL` is an exact Neon Auth trusted domain; no wildcard.
- [ ] Email verification is enabled in Neon Auth, and public sign-up is restricted if available.
- [ ] The bootstrap admin address is real, verified, and not `admin@example.com`.
- [ ] The firewall allows the app port from the LAN subnet only.
- [ ] No port forwarding, tunnel or public DNS entry exists.
- [ ] Windows is patched; Node is a supported LTS.
- [ ] Neon database, Auth and storage credentials are rotated if they appeared in a log or chat.
- [ ] `SESSION_COOKIE_SECURE=true` if HTTPS is added (reverse proxy).
- [ ] `/api/health` is reachable only on the LAN, like the rest of the app.
