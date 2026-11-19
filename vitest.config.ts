import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/web/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    /**
     * One worker. The database suites share one Neon database and some of them
     * assert against a whole table (the RGA notification job selects every open
     * RGA), so two forks running at once made the gate nondeterministic: the
     * same commit produced disjoint failure sets. Serialising the run is slower
     * and predictable, which is what a gate has to be.
     */
    maxWorkers: 1,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
    },
  },
})
