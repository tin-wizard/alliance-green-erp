# ADR 0002 — Local runtime topology

- **Status:** Accepted
- **Date:** 2026-11-11
- **Owners:** Platform

## Context

The ERP is used by staff on the company LAN. There is no requirement and no permission to
expose it to the public internet. The server machine may be Windows (most likely, because Sage
50 runs there) or Linux. Sage 50's `simply` database is reachable only from that machine's
localhost on ports 13540–13544, which forces the application process to run **on the same host
as Sage**.

A developer also needs a one-command local loop on macOS.

## Decision

**Topology: one Node process on the LAN host, one managed Postgres (Neon) over outbound TLS.**

```
LAN browsers ──HTTP──> [ Windows/Linux host ]
                         └─ node .output/server/index.mjs   (HOST=0.0.0.0, PORT=3000)
                              ├─ Postgres/TLS ──> Neon (pooled endpoint)
                              ├─ TCP 127.0.0.1:13540-13544 ──> Sage 50 `simply` (same host)
                              └─ local disk ──> .output/, logs/, uploads/ (future)
```

- **Production process manager:** Windows → NSSM (or Task Scheduler) running
  `node scripts/start.mjs`; Linux → systemd unit. The process must start on boot and restart on
  failure. Exact steps are in `platform/LOCAL-RUNBOOK.md`.
- **TLS on the LAN:** not terminated by this app. If the organisation later wants HTTPS, put a
  reverse proxy (Caddy/IIS) in front and set `APP_URL` and `SESSION_COOKIE_SECURE=true`. The
  app must not assume HTTPS.
- **Static assets:** served by the same Node process from `.output/public`. No CDN, no object
  storage in phase 1.
- **Environment:** a single `.env` beside the repo (gitignored) loaded by `scripts/start.mjs`
  before the server entry is imported. `pnpm dev` uses the same file.
- **Network exposure:** bind `HOST=0.0.0.0` so LAN clients can connect. The Windows firewall
  rule is scoped to the local subnet. No port forwarding, no tunnel, no public DNS.
- **Outbound:** HTTPS 443 to Neon only. If the company later forbids outbound DB traffic,
  the same code runs against a local Postgres by changing `DATABASE_URL`; nothing in the
  application depends on Neon-specific APIs. That is deliberate.

## Alternatives considered

1. **Docker Compose (legacy approach).** Kept as an optional developer convenience only (see
   runbook appendix). Rejected as the production runtime on Windows: Docker Desktop on a
   Windows host that must also reach Sage 50 on `localhost` adds a networking layer and a
   licensing dependency for no benefit. The Node process is simpler and debuggable.
2. **Run the app on a Linux box and Sage on Windows.** Rejected: the Sage adapter needs
   localhost-port access, and the human requires the Sage mechanism to be preserved exactly.
3. **Serverless / Vercel / Cloudflare.** Rejected by the human constraint: local-only LAN
   access, no public ingress.
4. **Separate web and worker processes.** Unnecessary at this scale. Scheduled work (compliance
   reminders, Sage sync) will run in-process behind a single-instance lock, documented when the
   first job lands.

## Consequences

- **Positive:** the app and Sage share a host, so the legacy port scan remains valid.
- **Positive:** the deployment unit is one directory plus one process. Backup is "copy `.env`
  and the repo, rely on Neon backups for data".
- **Negative:** a single process is a single point of failure. Mitigation: process manager
  restarts it; Neon is managed; the rebuild removes the legacy single-point-of-failure table
  corruption risk. A second instance is possible later: sessions are held by Neon Auth and the
  app cookie is self-contained, so any instance sharing `SESSION_SECRET` can serve it.
- **Negative:** no automatic HTTPS. Accepted for a LAN app; documented as a hardening step.
- **Negative:** developers on macOS cannot test against real Sage. They test discovery with a
  MySQL container plus the sentinel row (`SAGE_TEST_MYSQL_PORT`), or with a plain TCP listener for
  the unverified path.

## Verification

- `pnpm build && pnpm start` binds `HOST:PORT` and serves `/api/health`.
- The health payload reports the process host, port, uptime and DB connectivity.
