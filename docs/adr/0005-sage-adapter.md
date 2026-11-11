# ADR 0005 — Sage 50 adapter boundary and the documented MySQL protocol

- **Status:** Accepted; discovery and connection verification implemented, business sync pending
- **Date:** 2026-11-11
- **Owners:** Platform

## Context

The human requirement is explicit: **the Sage 50 connection must work exactly as it does now from
the local server. Do not replace it with a cloud integration.**

The first scaffold implemented discovery from the stub in `app/config/` (sequential TCP connects,
ascending ports). The cartographer then published `green-system/MODULES.md` §11, which documents
the real mechanism:

- Sage 50's own embedded **MySQL** server is reached with the native MySQL protocol, TCP,
  `localhost`, port family 13540–13544.
- The connection is made **without selecting a database**, then `simply` is selected.
- The acceptance test is not a TCP accept. It is the sentinel row
  `SELECT lId FROM tvendor WHERE lId = 663 AND sName = 'SagePort'`.
- Ports are tried **13541 first**, then 13540, 13542, 13543, 13544. The port is cached per request
  and re-validated.
- Credentials are `sageuser` plus a password held in `config/db_conn.php`; a second file,
  `config/sage_conn.php`, uses the same host/port/user with a different password.
- On failure the legacy portal includes `under_maintenance.php` and takes the **whole portal**
  down.

## Decision

`packages/sage` owns everything Sage. No module imports `mysql2`, reads `SAGE_*`, or knows a port.

1. **Driver:** `mysql2/promise` (pure JavaScript, no native build on the Sage host).
2. **Discovery is the sentinel probe.** For each configured port in order: TCP probe, then a MySQL
   connection to `simply`, then `SELECT lId FROM tvendor WHERE lId = 663 AND sName = 'SagePort'`.
   The first port with a row wins. A TCP listener without the row is rejected, which is the
   legacy behaviour and protects against another service holding a port.
3. **Port order is configuration with the legacy default:** `13541,13540,13542,13543,13544`.
   `SAGE_PORTS` may override it, but the default is the documented production order.
4. **Credentials:** `SAGE_USER` / `SAGE_PASSWORD` from env, never in code. Without them the
   adapter can still discover a TCP listener, but reports it as `unverified` and **refuses to
   connect**. It never claims a company is confirmed when it cannot check the sentinel.
5. **`connect()` verifies and holds a connection.** It re-runs the sentinel on the target, reads
   `SELECT VERSION()`, and keeps the connection for the caller; `disconnect()` closes it. It
   throws `SageUnavailableError` (503) or `SageNotConfiguredError` (503) rather than faking
   success.
6. **`health()`** caches for 30 seconds and reports `disabled | unreachable | unverified |
   verified | error`. `/api/health` and the dashboard render it directly.
7. **Business operations are not implemented yet.** Reads and writes (invoices, journals, tax,
   inventory) belong to the Sage module that consumes this adapter. Keeping raw SQL out of the
   platform prevents a half-translated write from corrupting the accounting database.
8. **Failure scope differs from legacy on purpose.** A Sage outage degrades Sage features and
   shows the status; it does **not** take the whole ERP down. The legacy `under_maintenance.php`
   behaviour exists because every page opened a Sage connection; the rebuild does not.

## Alternatives considered

1. **Keep TCP-only discovery in ascending order.** Rejected after `MODULES.md`: it is not what
   the legacy does, and it can select the wrong company on a machine running two Sage instances.
2. **Fixed port 13541, no scan.** Simpler, but the port genuinely moves between Sage upgrades and
   restarts; the scan is the reason the system survives that.
3. **A Sage cloud/SDK integration.** Rejected by the human constraint and by Sage 50 being a
   desktop product.
4. **Call the Sage MySQL database directly from module code.** Rejected: it is the coupling that
   made the legacy system brittle. The adapter is the only place that knows how to reach Sage.
5. **Implement all Sage reads and writes now.** Rejected: the module contract, permission model
   and posting rules for invoices/journals are not specified yet. Guessing accounting SQL is the
   highest-consequence mistake available.

## Consequences

- **Positive:** discovery now matches production, including the sentinel and the 13541-first order.
- **Positive:** a TCP listener on a Sage port cannot be mistaken for the CLS company.
- **Positive:** credentials and driver live in one package with its own tests.
- **Negative:** `mysql2` is a new dependency and must be bundled or externalised for the server
  output. It is pure JS, so there is no native-module failure mode on the Windows host.
- **Negative:** without credentials, health can only say `unverified`. That is deliberate.
- **Caution for the Sage module:** the legacy connection uses the server's default `latin1`
  charset and an empty SQL mode. Writes must set values explicitly, never rely on permissive
  coercion, and must respect that Sage re-reads the company file to show changes.

## Verification

- Unit tests cover TCP probing, ordered discovery, disabled health, unverified vs unreachable,
  refusal without credentials, and sentinel-company-not-found.
- An opt-in MySQL integration test (`SAGE_TEST_MYSQL_PORT`, `SAGE_TEST_MYSQL_WRONG_PORT`) proves:
  a MySQL server **with** the sentinel is accepted; a MySQL server **without** it is skipped; a
  plain TCP listener before the real company is skipped; `connect()` returns the server version.
- `pnpm test` runs the unit tests with no database; the integration test is skipped unless the
  environment variables are set.
