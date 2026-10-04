import { describe, expect, it } from 'vitest'
import { buildFileFacts } from '../../src/lib/map/facts'
import { parseSource } from '../../src/lib/map/parse'
import type {
  EvlogFeature,
  PairablePackage,
  ProjectFacts,
  RepeatedError,
} from '../../src/lib/map/project-facts'
import { auditAction } from '../../src/lib/map/rules/audit'
import { OPPORTUNITIES, REQUIREMENTS, RULES, getRule, runRuleSet } from '../../src/lib/map/rules/index'
import { scoreRoute } from '../../src/lib/map/score'
import type { FrameworkCapabilities, MapRule, RuleTarget } from '../../src/lib/map/rules/index'
import { classifySensitivity } from '../../src/lib/map/sensitivity'
import type { CheckId, CheckResult, Framework, RouteKind, ScanContext } from '../../src/lib/map/types'
import { getFramework } from '../../src/lib/frameworks'

interface Case {
  name: string
  code: string
  /** Defaults to `api`. */
  kind?: RouteKind
  /** Defaults to `nuxt`. */
  framework?: Framework
  /** Defaults to `/api/thing` — pick a sensitive path to arm the audit rule. */
  path?: string
  /** Defaults to `true`. */
  hasEvlog?: boolean
  /** evlog features the project already uses — the gate for opportunities. */
  features?: EvlogFeature[]
  /** Third-party packages present that evlog integrates with. */
  pairable?: PairablePackage[]
  /**
   * Everything in `package.json`. Defaults to `pairable`.
   *
   * Kept separate so a case can put a package in the project without declaring
   * it pairable — otherwise no test could tell the two lookups apart.
   */
  dependencies?: string[]
  /** Error catalogs the project declares — lets a suggestion name one. */
  catalogs?: string[]
  /**
   * Local modules that re-export evlog, as `moduleKey` → forwarded names.
   *
   * `{ evlog: ['useLogger'] }` stands for a `lib/evlog.ts` that does
   * `export { useLogger } from 'evlog'`.
   */
  barrels?: Record<string, string[]>
  /**
   * Inline errors that also exist elsewhere in the project.
   *
   * Given as the literal payload, e.g. `{ status: 404, why: 'Gone' }`, and
   * turned into the same signature the real scan computes — so a case cannot
   * pass by inventing a signature the analyser would never produce.
   */
  repeatedErrors?: string[]
}

interface RuleCases {
  valid: Case[]
  invalid: Array<Case & { message: RegExp }>
  /** Cases the rule should report as not-applicable rather than passing. */
  notApplicable?: Case[]
}

/**
 * Run one rule against inline source, the way `RuleTester` does.
 *
 * Everything the real scan does is reused — parse, facts, sensitivity — so a
 * case here fails for the same reasons a real project would.
 */
function check(rule: MapRule, testCase: Case): CheckResult | undefined {
  const framework = testCase.framework ?? 'nuxt'
  const file = framework === 'nuxt' ? 'server/api/thing.post.ts' : 'app/api/thing/route.ts'
  const parsed = parseSource(file, testCase.code)
  if (!parsed) throw new Error('fixture did not parse')

  const definition = getFramework(framework)
  const capabilities: FrameworkCapabilities = {
    requestLogger: definition.requestLogger,
    evlogAutoImports: definition.evlogAutoImports ?? [],
    requestLoggerMember: definition.requestLoggerMember,
  }
  const evlogBarrels = new Map(
    Object.entries(testCase.barrels ?? {}).map(([key, names]) => [key, new Set(names)]),
  )
  const facts = buildFileFacts(parsed, {
    evlogAutoImports: capabilities.evlogAutoImports,
    evlogBarrels,
    requestLoggerMember: capabilities.requestLoggerMember,
  })
  const raw = {
    framework,
    kind: testCase.kind ?? ('api' as RouteKind),
    method: 'POST',
    path: testCase.path ?? '/api/thing',
    file,
    handler: { line: 1, column: 0 },
  }
  const target: RuleTarget = { ...raw, sensitivity: classifySensitivity(raw, facts) }
  const ctx: ScanContext = {
    projectRoot: '/tmp',
    framework,
    projectName: 'test',
    hasEvlog: testCase.hasEvlog ?? true,
    verbose: false,
  }
  const project: ProjectFacts = {
    dependencies: new Set<string>(testCase.dependencies ?? testCase.pairable ?? []),
    features: new Set(testCase.features ?? []),
    pairable: new Set(testCase.pairable ?? []),
    catalogs: testCase.catalogs ?? [],
    evlogBarrels,
    repeatedErrors: buildRepeatedErrors(testCase.repeatedErrors ?? []),
  }

  const results = runRuleSet([rule], { ctx, target, parsed, facts, project, capabilities })
  return rule.category === 'requirement'
    ? results.checks[rule.id]
    : results.suggestions[rule.id]
}

/**
 * Signatures for errors the project repeats, computed the real way.
 *
 * The signature format is an implementation detail of `buildFileFacts`, so the
 * test asks the analyser for it rather than hard-coding a string that could
 * silently stop matching.
 */
function buildRepeatedErrors(payloads: string[]): Map<string, RepeatedError> {
  const repeated = new Map<string, RepeatedError>()
  for (const payload of payloads) {
    const parsed = parseSource('other.ts', `throw createError(${payload})`)
    if (!parsed) throw new Error(`repeated error payload did not parse: ${payload}`)
    const [error] = buildFileFacts(parsed).inlineErrors
    if (!error) throw new Error(`repeated error payload has no comparable literal: ${payload}`)
    repeated.set(error.signature, {
      label: error.label,
      files: ['server/api/other.post.ts', 'server/api/third.post.ts'],
    })
  }
  return repeated
}

const CASES: Record<CheckId, RuleCases> = {
  'wide-event': {
    valid: [
      {
        name: 'nuxt auto-imported useLogger',
        code: 'export default defineEventHandler((event) => { const log = useLogger(event) })',
      },
      {
        name: 'explicit evlog import',
        framework: 'next',
        code: 'import { useLogger } from \'evlog\'\nexport async function POST() { const log = useLogger() }',
      },
      {
        name: 'subpath evlog import',
        framework: 'next',
        code: 'import { useLogger } from \'evlog/nuxt\'\nexport async function POST() { const log = useLogger() }',
      },
      {
        name: 'withEvlog wrapper instruments without naming a logger',
        framework: 'next',
        code: 'import { withEvlog } from \'evlog/next\'\nexport const POST = withEvlog(async () => Response.json({ ok: true }))',
      },
      {
        name: 'withAudit writes onto the ambient event',
        code: 'import { withAudit } from \'evlog\'\nconst run = withAudit({ action: \'a\' }, () => ({ ok: true }))\nexport default defineEventHandler(() => run({}))',
      },
      {
        name: 'createLogger in a job',
        kind: 'cron',
        code: 'import { createLogger } from \'evlog\'\nexport default defineTask({ run() { const log = createLogger({ job: \'x\' }) } })',
      },
      {
        name: 'useLogger re-exported by a local barrel — evlog\'s own Next.js shape',
        framework: 'next',
        barrels: { evlog: ['useLogger'] },
        code: 'import { useLogger } from \'@/lib/evlog\'\nexport async function POST() { const log = useLogger() }',
      },
      {
        name: 'a barrel that re-exports everything forwards useLogger too',
        framework: 'next',
        barrels: { observability: ['*'] },
        code: 'import { useLogger } from \'~/lib/observability\'\nexport async function POST() { const log = useLogger() }',
      },
      {
        name: 'the logger read off the request context — evlog\'s own TanStack Start shape',
        framework: 'tanstack-start',
        code: 'import type { RequestLogger } from \'evlog\'\nexport const Route = { server: { handlers: { POST: async () => { const req = useRequest()\nconst log = req.context.log as RequestLogger\nlog.set({ a: 1 }) } } } }',
      },
      {
        name: 'the same logger destructured off the context',
        code: 'export default defineEventHandler((event) => { const { log } = event.context\nlog.set({ a: 1 }) })',
      },
      {
        name: 'the same logger used without ever being bound',
        code: 'export default defineEventHandler((event) => { event.context.log.set({ a: 1 }) })',
      },
      {
        name: 'the logger parked on the express request, bound then used',
        framework: 'express',
        code: 'app.post(\'/x\', (req, res) => { const log = req.log\nlog.set({ a: 1 }) })',
      },
      {
        name: 'the logger parked on the fastify request, used without being bound',
        framework: 'fastify',
        code: 'app.post(\'/x\', async (request) => { request.log.set({ a: 1 }) })',
      },
    ],
    invalid: [
      {
        name: 'fastify\'s own instance logger is not the request logger',
        framework: 'fastify',
        code: 'const fastify = Fastify()\nfastify.post(\'/x\', async () => { fastify.log.info(\'hit\') })',
        message: /dark event/,
      },
      {
        name: 'binding the instance logger does not make it the request logger either',
        framework: 'fastify',
        code: 'const app = Fastify()\napp.post(\'/x\', async () => { const log = app.log\nlog.info(\'hit\') })',
        message: /dark event/,
      },
      {
        name: 'nothing at all, on an ambient framework, says the event is empty not absent',
        code: 'export default defineEventHandler(() => ({ ok: true }))',
        message: /adds nothing to its request event/,
      },
      {
        name: 'nothing at all, on an explicit framework, says the event is missing',
        framework: 'next',
        code: 'export async function POST() { return Response.json({}) }',
        message: /dark event/,
      },
      {
        name: 'a local stub named useLogger is not evlog',
        code: 'function useLogger() { return { set() {} } }\nexport default defineEventHandler(() => { const log = useLogger() })',
        message: /adds nothing/,
      },
      {
        name: 'a local withAudit is not evlog\'s',
        code: 'function withAudit(o, f) { return f }\nexport default defineEventHandler(() => withAudit({}, () => 1)())',
        message: /adds nothing/,
      },
      {
        name: 'a useLogger destructured from something else shadows the auto-import',
        code: 'const { useLogger } = createStub()\nexport default defineEventHandler(() => { const log = useLogger() })',
        message: /adds nothing/,
      },
      {
        name: 'useLogger with no auto-import and no import',
        framework: 'next',
        code: 'export async function POST() { const log = useLogger() }',
        message: /dark event/,
      },
      {
        name: 'a local module that re-exports nothing from evlog is still local',
        framework: 'next',
        code: 'import { useLogger } from \'@/lib/logger\'\nexport async function POST() { const log = useLogger() }',
        message: /dark event/,
      },
      {
        name: 'a barrel only vouches for the names it forwards',
        framework: 'next',
        barrels: { evlog: ['withEvlog'] },
        code: 'import { useLogger } from \'@/lib/evlog\'\nexport async function POST() { const log = useLogger() }',
        message: /dark event/,
      },
      {
        name: 'the simple log API is not the request wide event',
        code: 'export default defineEventHandler(() => { log.info(\'done\'); return { ok: true } })',
        message: /adds nothing/,
      },
      {
        name: 'evlog not installed says so instead',
        code: 'export default defineEventHandler(() => ({ ok: true }))',
        hasEvlog: false,
        message: /evlog not installed/,
      },
    ],
    notApplicable: [{ name: 'pages do not own a server event', kind: 'page', code: 'const x = 1' },],
  },

  'context': {
    valid: [
      {
        name: 'log.set on a resolved logger',
        code: 'export default defineEventHandler((event) => { const log = useLogger(event); log.set({ a: 1 }) })',
      },
      {
        name: 'renamed logger binding',
        code: 'export default defineEventHandler((event) => { const wide = useLogger(event); wide.set({ a: 1 }) })',
      },
      {
        name: 'set on a logger taken off the request context',
        code: 'export default defineEventHandler((event) => { const log = event.context.log\nlog.set({ a: 1 }) })',
      },
      {
        name: 'set on a context logger destructured under another name',
        code: 'export default defineEventHandler((event) => { const { log: wide } = event.context\nwide.set({ a: 1 }) })',
      },
    ],
    invalid: [
      {
        name: 'logger with no context',
        code: 'export default defineEventHandler((event) => { const log = useLogger(event) })',
        message: /no log\.set\(\)/,
      },
      {
        name: 'a Map.set() is not request context',
        code: 'export default defineEventHandler((event) => { const cache = new Map(); cache.set(\'a\', 1) })',
        message: /no log\.set\(\)/,
      },
    ],
  },

  'structured-errors': {
    valid: [
      {
        name: 'createError with why and fix',
        code: 'export default defineEventHandler(() => { throw createError({ status: 400, why: \'w\', fix: \'f\' }) })',
      },
    ],
    invalid: [
      {
        name: 'plain Error',
        code: 'export default defineEventHandler(() => { throw new Error(\'boom\') })',
        message: /use createError/,
      },
      {
        name: 'createError missing fix',
        code: 'export default defineEventHandler(() => { throw createError({ why: \'w\' }) })',
        message: /missing fix/,
      },
      {
        name: 'createError missing why',
        code: 'export default defineEventHandler(() => { throw createError({ fix: \'f\' }) })',
        message: /missing why/,
      },
      {
        name: 'createError with neither',
        code: 'export default defineEventHandler(() => { throw createError({ status: 400 }) })',
        message: /missing why and fix/,
      },
    ],
    notApplicable: [
      {
        name: 'a handler that raises nothing has no error to shape',
        code: 'export default defineEventHandler(() => ({ ok: true }))',
      },
    ],
  },

  'audit': {
    valid: [
      {
        name: 'money path with an audit record',
        path: '/api/checkout',
        code: 'export default defineEventHandler((event) => { const log = useLogger(event); log.audit({ action: \'a\' }) })',
      },
      {
        name: 'a denial through an optional chain still counts',
        path: '/api/checkout',
        code: 'export default defineEventHandler((event) => { const log = useLogger(event); log.audit?.deny(\'nope\', { action: \'a\' }) })',
      },
    ],
    invalid: [
      {
        name: 'money path without an audit record',
        path: '/api/checkout',
        code: 'export default defineEventHandler((event) => { const log = useLogger(event) })',
        message: /audit trail/,
      },
      {
        name: 'a stub logger cannot produce an audit trail',
        path: '/api/checkout',
        code: 'function useLogger() { return { audit() {} } }\nexport default defineEventHandler(() => { const log = useLogger(); log.audit({}) })',
        message: /audit trail/,
      },
    ],
    notApplicable: [
      {
        name: 'an ordinary path needs no audit record',
        path: '/api/health',
        code: 'export default defineEventHandler(() => ({ ok: true }))',
      },
    ],
  },

  'error-handling': {
    valid: [
      {
        name: 'catch that logs',
        code: 'export default defineEventHandler((event) => { const log = useLogger(event); try { go() } catch (e) { log.error(e) } })',
      },
      {
        name: 'catch that rethrows',
        code: 'export default defineEventHandler(() => { try { go() } catch (e) { throw e } })',
      },
      {
        name: 'catch that falls back with a return',
        code: 'export default defineEventHandler(() => { try { go() } catch { return { ok: false } } })',
      },
      {
        name: 'catch that branches before it logs',
        code: 'export default defineEventHandler((event) => { const log = useLogger(event); try { go() } catch (e) { if (retryable(e)) { log.error(e) } else { throw e } } })',
      },
      {
        name: 'catch that switches on the failure',
        code: 'export default defineEventHandler(() => { try { go() } catch (e) { switch (e.code) { case \'x\': throw e } } })',
      },
    ],
    invalid: [
      {
        name: 'empty catch',
        code: 'export default defineEventHandler(() => { try { go() } catch {} })',
        message: /empty catch/,
      },
      {
        name: 'catch that only increments a counter',
        code: 'export default defineEventHandler(() => { let n = 0; try { go() } catch { n++ } })',
        message: /swallows error/,
      },
    ],
    notApplicable: [
      {
        name: 'no catch to inspect — the framework integration logs what escapes',
        code: 'export default defineEventHandler(async () => await $fetch(\'/api/x\'))',
      },
    ],
  },

  'page-error-handling': {
    valid: [
      {
        name: 'useFetch with an error binding',
        kind: 'page',
        code: 'const { data, error } = await useFetch(\'/api/x\')',
      },
      {
        name: 'try/catch around $fetch',
        kind: 'page',
        code: 'try { await $fetch(\'/api/x\') } catch (e) { console.error(e) }',
      },
      {
        name: 'promise catch',
        kind: 'page',
        code: 'const data = await $fetch(\'/api/x\').catch(() => null)',
      },
    ],
    invalid: [
      {
        name: 'bare useFetch',
        kind: 'page',
        code: 'const { data } = await useFetch(\'/api/x\')',
        message: /without error handling/,
      },
      {
        name: 'a try elsewhere on the page does not cover the fetch',
        kind: 'page',
        code: 'try { JSON.parse(raw) } catch { }\nconst { data } = await useFetch(\'/api/x\')',
        message: /useFetch\(\) without error handling/,
      },
      {
        name: 'guarding one fetch says nothing about the next one',
        kind: 'page',
        code: 'const a = await $fetch(\'/api/a\').catch(() => null)\nconst b = await $fetch(\'/api/b\')',
        message: /without error handling/,
      },
    ],
    notApplicable: [{ name: 'a page that fetches nothing', kind: 'page', code: 'const title = \'hello\'' }],
  },

  'error-catalog': {
    valid: [
      {
        name: 'nothing to promote when no error is thrown inline',
        features: ['error-catalog'],
        code: 'export default defineEventHandler(() => ({ ok: true }))',
      },
      {
        name: 'a one-off inline error is left alone — duplication is the whole signal',
        features: ['error-catalog'],
        code: 'export default defineEventHandler(() => { throw createError({ status: 402, message: \'Card declined\' }) })',
      },
      {
        name: 'a different error is not the repeated one',
        features: ['error-catalog'],
        repeatedErrors: ['{ status: 404, message: \'Order not found\' }'],
        code: 'export default defineEventHandler(() => { throw createError({ status: 402, message: \'Card declined\' }) })',
      },
      {
        name: 'an error built from variables cannot be compared, so it is not claimed',
        features: ['error-catalog'],
        repeatedErrors: ['{ status: 404, message: \'Order not found\' }'],
        code: 'export default defineEventHandler(() => { throw createError({ status, message: reason }) })',
      },
    ],
    invalid: [
      {
        name: 'the same error is spelled out here and elsewhere',
        features: ['error-catalog'],
        repeatedErrors: ['{ status: 402, message: \'Card declined\' }'],
        code: 'export default defineEventHandler(() => { throw createError({ status: 402, message: \'Card declined\' }) })',
        message: /"402 Card declined" is spelled out here and in 1 other file/,
      },
      {
        name: 'extra non-literal properties do not break the match',
        features: ['error-catalog'],
        repeatedErrors: ['{ status: 402, message: \'Card declined\' }'],
        code: 'export default defineEventHandler(() => { throw createError({ status: 402, message: \'Card declined\', context: { id } }) })',
        message: /one catalog entry would cover them/,
      },
    ],
    notApplicable: [
      {
        name: 'silent when the project has no catalog — never sell a feature',
        repeatedErrors: ['{ status: 402, message: \'Card declined\' }'],
        code: 'export default defineEventHandler(() => { throw createError({ status: 402, message: \'Card declined\' }) })',
      },
    ],
  },

  'audit-coverage': {
    valid: [
      {
        name: 'the write is already audited',
        features: ['audit'],
        code: 'export default defineEventHandler((event) => { const log = useLogger(event); db.update({}); log.audit({ action: \'a\' }) })',
      },
    ],
    invalid: [
      {
        name: 'unaudited write while the project audits elsewhere',
        features: ['audit'],
        code: 'export default defineEventHandler(() => { db.update({ id: 1 }) })',
        message: /no audit record/,
      },
    ],
    notApplicable: [
      {
        name: 'silent when the project does not audit at all',
        code: 'export default defineEventHandler(() => { db.update({ id: 1 }) })',
      },
      {
        name: 'silent with no state change',
        features: ['audit'],
        code: 'export default defineEventHandler(() => db.find({}))',
      },
      {
        name: 'left to the audit requirement on a money path',
        features: ['audit'],
        path: '/api/checkout',
        code: 'export default defineEventHandler(() => { db.update({ id: 1 }) })',
      },
    ],
  },

  'ai-logging': {
    valid: [
      {
        name: 'model call already wrapped with evlog/ai',
        pairable: ['ai'],
        features: ['ai'],
        code: 'import { createAIMiddleware } from \'evlog/ai\'\nexport default defineEventHandler(() => generateText({}))',
      },
      {
        name: 'the middleware is installed once elsewhere, on the model this handler reuses',
        pairable: ['ai'],
        features: ['ai'],
        code: 'import { model } from \'~/lib/ai\'\nexport default defineEventHandler(() => generateText({ model }))',
      },
    ],
    invalid: [
      {
        name: 'model call with the AI SDK installed and no evlog/ai',
        pairable: ['ai'],
        code: 'export default defineEventHandler(() => streamText({ model }))',
        message: /without evlog\/ai/,
      },
    ],
    notApplicable: [
      {
        name: 'silent without the ai package',
        code: 'export default defineEventHandler(() => streamText({ model }))',
      },
      {
        name: 'silent when nothing calls a model',
        pairable: ['ai'],
        code: 'export default defineEventHandler(() => ({ ok: true }))',
      },
    ],
  },

  'auth-identity': {
    valid: [],
    invalid: [
      {
        name: 'auth path with better-auth installed and no evlog integration',
        pairable: ['better-auth'],
        path: '/api/auth/login',
        code: 'export default defineEventHandler(event => auth.handler(event))',
        message: /no user identity/,
      },
    ],
    notApplicable: [
      {
        name: 'silent without better-auth',
        path: '/api/auth/login',
        code: 'export default defineEventHandler(event => auth.handler(event))',
      },
      {
        name: 'silent once evlog/better-auth is adopted',
        pairable: ['better-auth'],
        features: ['better-auth'],
        path: '/api/auth/login',
        code: 'export default defineEventHandler(event => auth.handler(event))',
      },
      {
        name: 'silent on a route unrelated to auth',
        pairable: ['better-auth'],
        path: '/api/products',
        code: 'export default defineEventHandler(() => db.find({}))',
      },
    ],
  },
}

describe('rule registry', () => {
  it('every rule is covered by the case table', () => {
    expect(RULES.map(rule => rule.id).sort()).toEqual(Object.keys(CASES).sort())
  })

  it('every rule carries the metadata the report needs', () => {
    for (const rule of RULES) {
      expect(rule.title.length, `${rule.id} title`).toBeLessThanOrEqual(8)
      expect(rule.expects, `${rule.id} expects`).toBeTruthy()
      expect(rule.question, `${rule.id} question`).toMatch(/\?$/)
      expect(rule.docs, `${rule.id} docs`).toMatch(/^\//)
      expect(rule.appliesTo.kinds.length, `${rule.id} kinds`).toBeGreaterThan(0)
    }
  })

  it('only requirements carry a weight, so a suggestion cannot cost points', () => {
    for (const rule of REQUIREMENTS) {
      expect(rule.weight, `${rule.id} weight`).toBeGreaterThan(0)
    }
    for (const rule of OPPORTUNITIES) {
      expect(rule, `${rule.id} weight`).not.toHaveProperty('weight')
    }
    expect(OPPORTUNITIES.length).toBeGreaterThan(0)
  })

  it('every opportunity is gated on the project already using the feature', () => {
    for (const rule of OPPORTUNITIES) {
      expect(rule.appliesTo.when, `${rule.id} must declare a gate`).toBeTypeOf('function')
    }
  })
})

describe('suggested audit action', () => {
  const cases: Array<[string, string | null, string]> = [
    ['/api/auth/login', 'POST', 'auth.login'],
    ['/api/payments/stripe', 'POST', 'payments.stripe'],
    ['/api/orders/:id/refund', 'POST', 'orders.refund'],
    ['/api/orders', 'POST', 'orders.created'],
    ['/api/orders/:id', 'DELETE', 'orders.deleted'],
    ['/api/:id', null, 'resource.action'],
  ]

  for (const [path, method, expected] of cases) {
    it(`reads ${expected} off ${method ?? 'ANY'} ${path}`, () => {
      expect(auditAction({ path, method })).toBe(expected)
    })
  }
})

describe('score neutrality', () => {
  it('a failing opportunity removes no points', () => {
    const rule = OPPORTUNITIES[0]!
    const withSuggestion = scoreRoute({ [rule.id]: { status: 'fail' } })
    expect(withSuggestion).toBe(100)
  })
})

for (const [id, cases] of Object.entries(CASES) as Array<[CheckId, RuleCases]>) {
  describe(id, () => {
    const rule = getRule(id)!

    for (const testCase of cases.valid) {
      it(`passes: ${testCase.name}`, () => {
        const result = check(rule, testCase)
        /* An opportunity with nothing to say says nothing — it never occupies a
           row in the report just to report success. */
        if (rule.category === 'opportunity') {
          expect(result).toBeUndefined()
          return
        }
        expect(result).toEqual({ status: 'pass' })
      })
    }

    for (const testCase of cases.invalid) {
      it(`fails: ${testCase.name}`, () => {
        const result = check(rule, testCase)
        expect(result?.status).toBe('fail')
        expect(result?.message).toMatch(testCase.message)
        expect(result?.evidence?.line).toBeGreaterThan(0)
      })
    }

    for (const testCase of cases.notApplicable ?? []) {
      it(`skips: ${testCase.name}`, () => {
        const result = check(rule, testCase)
        expect(result === undefined || result.status === 'n/a').toBe(true)
      })
    }
  })
}
