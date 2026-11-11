/**
 * Production entry point.
 *
 * `pnpm start` runs this instead of `node .output/server/index.mjs` so that:
 *   1. .env is loaded before any server module reads process.env,
 *   2. a missing build fails with a readable message,
 *   3. HOST/PORT defaults are explicit for a LAN server.
 *
 * Nitro's server entry starts listening itself.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')

const envPath = resolve(root, '.env')
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath)
  } catch (error) {
    console.error(`[start] Could not load ${envPath}:`, error instanceof Error ? error.message : error)
    process.exit(1)
  }
} else {
  console.warn('[start] No .env found. Copy .env.example to .env before production use.')
}

process.env.NODE_ENV ??= 'production'
process.env.HOST ??= '0.0.0.0'
process.env.PORT ??= '3000'

const candidates = [
  resolve(root, 'apps/web/.output/server/index.mjs'),
  resolve(root, '.output/server/index.mjs'),
]
const entry = candidates.find((candidate) => existsSync(candidate))

if (!entry) {
  console.error(
    '[start] No server build found. Run `pnpm build` first.\n' +
      `Checked:\n  ${candidates.join('\n  ')}`,
  )
  process.exit(1)
}

await import(pathToFileURL(entry).href)
