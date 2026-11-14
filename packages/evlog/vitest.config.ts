import codspeedPlugin from '@codspeed/vitest-plugin'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // NestJS uses legacy TypeScript decorators with reflect-metadata. Vite 8's
  // default oxc transformer doesn't yet emit decorator metadata, and vitest's
  // esbuild fallback can't either. SWC is the only option that preserves both
  // decorator semantics and metadata for `Test.createTestingModule()` to work.
  // `unplugin-swc` only transforms files matching the SWC parser config; other
  // tests are unaffected (their AST doesn't change shape).
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
    codspeedPlugin(),
  ],
  test: {
    hookTimeout: 30_000,
    environment: 'node',
    // The `hono` peer accepts Hono 4 and Hono 5, so the Hono suite runs once per major.
    projects: [
      { extends: true, test: { name: 'evlog', include: ['test/**/*.test.ts'] } },
      {
        extends: true,
        resolve: { alias: { hono: 'hono-5' } },
        test: { name: 'hono-5', include: ['test/frameworks/hono.test.ts'] },
      },
    ],
    // Flag tests slower than this for triage; lift the suite out of the
    // "everything is fast, no signal" zone. Custom reporter in
    // test/helpers/slowReporter.ts logs offenders > 500ms.
    slowTestThreshold: 250,
    reporters: process.env.CI
      ? ['default', './test/helpers/slowReporter.ts']
      : ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Exclude framework runtimes whose source is loaded by the framework's
      // own module resolution (Nuxt, Nitro v2/v3, ambient runtime helpers) —
      // their code path does run, but v8 instrumentation never sees it
      // because it's loaded outside Vitest's worker. Behavior is verified by
      // integration tests (`test/nitro-v3/nitro-v3.test.ts`,
      // `test/nitro-plugin*.test.ts`, etc.).
      exclude: ['src/nuxt/**', 'src/nitro/**', 'src/nitro-v3/**', 'src/runtime/**'],
      // Thresholds set ~3 points below the measured baseline (Statements
      // 85.9%, Branches 79.5%, Functions 87.3%, Lines 87.8%) so a regression
      // fails CI without false alarms on flaky-but-fast metrics. Bump again
      // when adding meaningful coverage to a hot module — see the bump policy
      // in `test/README.md` § "Coverage thresholds".
      thresholds: {
        statements: 83,
        branches: 76,
        functions: 84,
        lines: 85,
      },
    },
    benchmark: {
      include: ['bench/**/*.bench.ts'],
      outputJson: 'bench/results.json',
    },
  },
})
