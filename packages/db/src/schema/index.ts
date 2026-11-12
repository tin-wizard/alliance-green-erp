/**
 * Schema registry.
 *
 * - `./app`          the rebuild's own tables, in the `app` Postgres schema.
 * - `./legacy/*`     the 175-table contract mirror, in `public`, generated from
 *                    `packages/db/contract/schema.json`. Names are unchanged.
 * - `./migration`    the migration harness's control schema (`migration`).
 *
 * Module agents add app tables to their own domain file; the legacy mirror is
 * generated and must never be edited by hand.
 */
export * from './app'
export * from './legacy/index'
export * from './migration'
