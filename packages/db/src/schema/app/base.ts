import { pgSchema } from 'drizzle-orm/pg-core'

/**
 * The `app` Postgres schema: every table the rebuild owns.
 *
 * Lives in its own module so domain slices (`app/workorder.ts`, and later the
 * other modules) can import it without a circular reference through `app.ts`.
 */
export const app = pgSchema('app')
