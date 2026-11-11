import { defineConfig } from 'drizzle-kit'
import { config as loadEnv } from 'dotenv'

// pnpm runs this with cwd=packages/db. Load the repo-root .env first, then a
// package-local one if present. Neither overrides real process env.
loadEnv({ path: '../../.env' })
loadEnv()

// Migrations always use the direct (non-pooled) connection when available.
// The pooled endpoint is for the runtime, not for DDL.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL

if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and add your Neon connection string.',
  )
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
  casing: 'snake_case',
})
