# Admin

Users, typed settings and the activity log. The module is the administrative
surface over `app.users`, `app.user_permissions`, `app.settings` and
`app.audit_log`; credentials and sign-in sessions remain owned by Neon Auth.

## Users

`/admin/users` lists every application user with their role, enablement,
per-user overrides, linked subcontractor and last sign-in.

- **Invite** creates the Neon Auth identity (`POST /sign-up/email`) with a random
  password that is never returned or logged, inserts the `app.users` row with the
  chosen role, then requests the password-reset email
  (`POST /request-password-reset`). The link expires after 15 minutes.
  - If the provider rejects the sign-up, nothing is written.
  - If the provider creates the identity but the row cannot be inserted, the
    error says so; the orphan identity still has to be removed in Neon Auth.
  - If the row is inserted but the email fails, the user exists and the error
    tells the operator to use **Force reset** after fixing mail.
- **Role** updates `app.users.role`; the next request re-evaluates the session
  grants from the default matrix.
- **Disable** sets `app.users.is_enabled = false`. A resolved session for a
  disabled user is rejected, so the identity can sign in to Neon Auth but cannot
  use the application. Enabling reverses it. Provider-level ban is a separate
  Neon Auth admin action and is not called here.
- **Force reset** sends another password-reset email and records
  `admin.user.force_reset`.
- **Overrides** grant a permission key from the code catalogue beyond the role
  default, with an optional note, optional expiry and optional subcontractor
  scope. Only keys in `PERMISSIONS` can be granted; unknown keys are rejected.
  Revoking deletes the override. Grant and revoke both write audit rows.

The last enabled administrator cannot be disabled or demoted; the update is
rejected instead of locking everyone out.

Neon Auth exposes no server-side admin API in this build for setting a password,
changing role or revoking sessions without a provider admin cookie. The Admin
module therefore keeps credential operations to identity creation and password
reset, and treats the application role as the authority for module access.

## Settings

`/admin/settings` edits the code-owned catalogue in
`apps/web/src/modules/admin/lib/settings.ts`. An unknown key cannot be written;
numbers are bounded, strings must be non-empty, and the timezone must be a valid
IANA zone. Overrides live in `app.settings` with the administrator and time;
defaults live in code and are shown as **Default** until changed. Every save
records `admin.settings.update` with the previous and new value.

Current keys:

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `company.name` | string | `Alliance Lighting` | Trading name used by the application. |
| `company.timezone` | string | `America/Toronto` | Business timezone for dates and reminders. |
| `reports.default_page_size` | number | `100` | Rows shown when a report opens (25–500). |
| `compliance.expiry_warning_days` | number | `30` | Window in which a current document is expiring (1–365). |

## Activity log

`/admin/audit` reads `app.audit_log` newest first. Filters combine actor (name or
id), action (substring, with the known actions offered as suggestions), entity
type, entity id and an inclusive date range. The table pages 100 rows at a time
and shows actor, action, entity, summary, IP-insensitive context and timestamp.
The log is append-only; the viewer never edits or deletes rows.

## Permissions

`admin:users` (view and manage users and overrides), `admin:settings` (view and
change settings) and `admin:audit` (read the log), all admin-only by default.
Server functions carry their own permission middleware and the core functions
assert the grant again, so a direct call cannot bypass the UI.

## Migration

`0012` creates `app.settings`. `app.users`, `app.user_permissions` and
`app.audit_log` predate the Admin module; no table is altered.
