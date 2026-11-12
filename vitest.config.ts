import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    /**
     * Database suites hold one long transaction each against a single Neon
     * compute. Eight parallel forks made the heaviest suites queue past their
     * own test timeouts; four workers keeps every suite inside its budget
     * without serialising the run. Each fork still owns one pool.
     */
    maxWorkers: 4,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
    },
  },
})
