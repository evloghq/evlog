import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      /* About three points under the measured numbers, as in packages/evlog:
         a real drop fails, a refactor that moves a branch does not. */
      thresholds: {
        statements: 86,
        branches: 76,
        functions: 88,
        lines: 87,
      },
    },
  },
})
