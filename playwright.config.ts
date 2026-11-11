import { defineConfig, devices } from '@playwright/test'

/**
 * E2E runs against the production build, not the dev server.
 * `pnpm test:e2e` builds first.
 *
 * No DATABASE_URL is supplied, so the app must still boot and serve the login
 * page with health reporting "degraded". That is the honest baseline until a
 * Neon database is provisioned.
 */
const PORT = 3100

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/start.mjs',
    cwd: '.',
    url: `http://127.0.0.1:${PORT}/healthz`,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      APP_URL: `http://127.0.0.1:${PORT}`,
      SESSION_SECRET: 'e2e-only-secret-that-is-at-least-32-characters',
      // Opt-in integration run: set E2E_DATABASE_URL to a migrated + seeded DB.
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
      // Neon Auth comes from .env unless overridden. A real sign-in also needs
      // this origin registered as a trusted domain in Neon Auth.
      NEON_AUTH_BASE_URL: process.env.NEON_AUTH_BASE_URL ?? '',
      NEON_AUTH_JWKS_URL: process.env.NEON_AUTH_JWKS_URL ?? '',
      SAGE_ENABLED: 'false',
    },
  },
})
