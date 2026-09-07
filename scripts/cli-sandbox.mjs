#!/usr/bin/env node
/**
 * Disposable apps to run `@evlog/cli` against, from the monorepo root.
 *
 * `evlog init` writes files and `evlog map --baseline` wants a git history, so
 * neither can be exercised by hand against a real app without leaving a mess to
 * undo. This builds throwaway copies under `.sandbox/` — one per framework,
 * each a git repo with `evlog` linked in — and `--smoke` drives every
 * non-interactive feature across them and reports what broke.
 *
 *   node scripts/cli-sandbox.mjs            # (re)create the apps, print a cheat sheet
 *   node scripts/cli-sandbox.mjs --reset    # undo whatever you ran, keep the apps
 *   node scripts/cli-sandbox.mjs --smoke    # create, then run the whole feature matrix
 *   node scripts/cli-sandbox.mjs --keep     # reuse whatever is already there
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SANDBOX = join(ROOT, '.sandbox')
const FIXTURES = join(ROOT, 'packages/cli/test/map/fixtures')
const CLI = join(ROOT, 'packages/cli/bin/evlog.mjs')
const EVLOG = join(ROOT, 'packages/evlog')

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code, text) => color ? `[${code}m${text}[0m` : text
const green = text => paint('32', text)
const red = text => paint('31', text)
const dim = text => paint('2', text)
const bold = text => paint('1', text)
const cyan = text => paint('36', text)

/* ── the apps ───────────────────────────────────────────────────────────── */

/**
 * All but one come from the `map` test fixtures rather than being written
 * again here: they are already realistic apps with deliberately uneven
 * instrumentation, which is exactly what makes a `map` report worth reading.
 * Nitro has no fixture, so it is generated.
 */
const APPS = [
  { name: 'nuxt', fixture: 'nuxt-basic' },
  { name: 'next', fixture: 'next-app-router', augment: augmentNextApp },
  { name: 'tanstack', fixture: 'tanstack-basic' },
  { name: 'nitro', generate: generateNitroApp },
  { name: 'hono', fixture: 'hono-basic' },
  { name: 'express', fixture: 'express-basic', mapOnly: true },
  { name: 'fastify', fixture: 'fastify-basic', mapOnly: true },
  { name: 'elysia', fixture: 'elysia-basic', mapOnly: true },
]

/**
 * The same structured error, written out twice.
 *
 * Every app gets this so `init` has something to seed an error catalog from:
 * one inline error is a local decision, the same one in two files is the
 * evidence the offer is gated on. Added here rather than in the `map` fixtures,
 * which exist to pin scan behaviour and should not grow features for a
 * different command's benefit.
 */
function addRepeatedError(dir) {
  const body = `import { createError } from 'evlog'

export function assertCard(ok: boolean) {
  if (ok) return
  throw createError({
    status: 402,
    message: 'Card declined',
    why: 'The issuer refused the charge',
  })
}
`
  write(dir, 'sandbox/billing-checkout.ts', body)
  write(dir, 'sandbox/billing-renewal.ts', body)
}

/**
 * Give the Next app a real evlog factory.
 *
 * The fixture ships a re-export barrel, which is a legitimate shape but the one
 * `init` cannot splice into — so every sandbox run ended at "paste this
 * snippet" and the patch path went untested by hand. A factory call is also
 * what the framework guide tells people to write.
 */
function augmentNextApp(dir) {
  write(dir, 'lib/evlog.ts', `import { createEvlog } from 'evlog/next'

export const { withEvlog, useLogger, log, createError } = createEvlog({
  service: 'next-sandbox',
})
`)
}

function generateNitroApp(dir) {
  write(dir, 'package.json', `${JSON.stringify({
    name: 'nitro-sandbox',
    private: true,
    type: 'module',
    dependencies: { nitro: '^3.0.0' },
  }, null, 2)}\n`)

  write(dir, 'nitro.config.ts', `import { defineConfig } from 'nitro'

export default defineConfig({
  compatibilityDate: '2025-01-01',
})
`)

  // Instrumented: a wide event with business context and an audit trail.
  write(dir, 'routes/api/checkout.post.ts', `import { defineHandler, readBody } from 'nitro/h3'
import { useLogger } from 'evlog/nitro/v3'

export default defineHandler(async (event) => {
  const log = useLogger(event)
  const body = await readBody(event)
  log.set({ cart: { items: body.items?.length ?? 0 } })
  log.audit({ action: 'checkout.completed', resource: 'order', actor: body.userId })
  return { ok: true }
})
`)

  // Dark on purpose: something for `map` to complain about.
  write(dir, 'routes/api/reports.get.ts', `import { defineHandler } from 'nitro/h3'

export default defineHandler(() => ({ reports: [] }))
`)

  // Sensitive and dark: this is what should land under FIX FIRST.
  write(dir, 'routes/api/payments/refund.post.ts', `import { defineHandler } from 'nitro/h3'

export default defineHandler(() => ({ refunded: true }))
`)
}

function write(dir, path, contents) {
  const target = join(dir, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents, 'utf8')
}

/* ── setup ──────────────────────────────────────────────────────────────── */

function ensureCliBuilt() {
  const dist = join(ROOT, 'packages/cli/dist/cli.mjs')
  const fresh = existsSync(dist)
    && statSync(dist).mtimeMs > newestSourceTime(join(ROOT, 'packages/cli/src'))
  if (fresh) return

  process.stderr.write(dim('building @evlog/cli—\n'))
  const built = spawnSync('pnpm', ['--filter', '@evlog/cli', 'build'], { cwd: ROOT, stdio: 'inherit' })
  if (built.status !== 0) {
    process.stderr.write(red('could not build the CLI — run `pnpm --filter @evlog/cli build`\n'))
    process.exit(1)
  }
}

function newestSourceTime(dir) {
  let newest = 0
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else newest = Math.max(newest, statSync(path).mtimeMs)
    }
  }
  walk(dir)
  return newest
}

/**
 * Build one app.
 *
 * `evlog` is symlinked into `node_modules` so `doctor` resolves a real install
 * and `init` reports "already installed" — the state a user is actually in when
 * they run these commands. Each app is its own git repo so `--baseline` has a
 * `git:HEAD` to read.
 */
function createApp(app) {
  const dir = join(SANDBOX, app.name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  if (app.fixture) cpSync(join(FIXTURES, app.fixture), dir, { recursive: true })
  else app.generate(dir)
  app.augment?.(dir)
  addRepeatedError(dir)

  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  symlinkSync(EVLOG, join(dir, 'node_modules/evlog'), 'dir')

  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, '-c', 'user.email=sandbox@evlog.dev', '-c', 'user.name=sandbox', 'commit', '-qm', 'sandbox')

  return dir
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

/**
 * Roll an app back to how it was created, without rebuilding it.
 *
 * The initial commit is the pristine state and it includes the `evlog` symlink,
 * so a checkout plus a clean restores everything the commands wrote — and puts
 * the link back rather than leaving the app unable to resolve evlog. Falls back
 * to a full rebuild if the app is not there or its git repo is gone.
 */
function resetApp(app) {
  const dir = join(SANDBOX, app.name)
  if (!existsSync(join(dir, '.git'))) return createApp(app)

  try {
    git(dir, 'checkout', '--', '.')
    git(dir, 'clean', '-fdq')
    return dir
  } catch {
    return createApp(app)
  }
}

/** Run the CLI against an app. Never interactive: no TTY, and `CI` is set. */
function cli(cwd, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', NO_COLOR: '1', EVLOG_TELEMETRY: '0' },
  })
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/* ── the feature matrix ─────────────────────────────────────────────────── */

const checks = []
const check = (name, fn) => checks.push({ name, fn })

function expect(condition, detail) {
  if (!condition) throw new Error(detail)
}

function json(result) {
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error(`stdout was not JSON: ${result.stdout.slice(0, 120)}`)
  }
}

check('doctor --json', (dir) => {
  const result = cli(dir, ['doctor', '--json'])
  const payload = json(result)
  expect(payload.schemaVersion === 2, `schemaVersion ${payload.schemaVersion}`)
  expect(Array.isArray(payload.checks), 'no checks array')
  expect(payload.checks.some(c => c.id === 'evlog' && c.status === 'ok'), 'evlog was not resolved')
})

check('map --json --no-write', (dir) => {
  const payload = json(cli(dir, ['map', '--json', '--no-write']))
  expect(typeof payload.map.score === 'number', 'score is not a number')
  expect(payload.map.routes.length > 0, 'no entry points found')
  expect(payload.mapPath === null, '--no-write still reported a path')
})

check('map --all / map <entry>', (dir) => {
  expect(cli(dir, ['map', '--all', '--no-write']).code === 0, '--all did not exit 0')
  const payload = json(cli(dir, ['map', '--json', '--no-write']))
  const entry = payload.map.routes[0].file
  expect(cli(dir, ['map', entry, '--no-write']).code === 0, `inspecting ${entry} did not exit 0`)
})

check('map --min-score gates', (dir) => {
  expect(cli(dir, ['map', '--min-score', '100', '--no-write']).code === 1, '100 did not fail')
  expect(cli(dir, ['map', '--min-score', '0', '--no-write']).code === 0, '0 did not pass')
  expect(cli(dir, ['map', '--min-score', 'abc', '--no-write']).code === 1, 'a bad threshold was accepted')
})

check('map --baseline catches a regression', (dir) => {
  cli(dir, ['map'])
  git(dir, 'add', '-A')
  git(dir, '-c', 'user.email=s@e.dev', '-c', 'user.name=s', 'commit', '-qm', 'baseline')
  const before = readFileSync(join(dir, 'evlog.map.json'), 'utf8')

  /* Rename the calls rather than gutting the files. Replacing a route with a
     bare `export default` also removes it from the scan, and a deleted entry
     point is deliberately not a regression — the check would then be asserting
     the opposite of what it means to. Renaming keeps every route in place and
     valid, and flips its checks from pass to fail. */
  const payload = JSON.parse(before)
  for (const route of payload.routes) {
    const file = join(dir, route.file)
    if (!existsSync(file)) continue
    const source = readFileSync(file, 'utf8')
      .replaceAll('useLogger', 'useLoggerRenamed')
      .replaceAll('log.set', 'log.setRenamed')
      .replaceAll('log.audit', 'log.auditRenamed')
      .replaceAll('createError', 'createErrorRenamed')
    writeFileSync(file, source, 'utf8')
  }

  const result = cli(dir, ['map', '--baseline'])
  expect(result.code === 1, 'a regression did not fail the gate')
  expect(result.stderr.includes('REGRESSED'), 'no REGRESSED section printed')
  expect(readFileSync(join(dir, 'evlog.map.json'), 'utf8') === before, 'the baseline was overwritten')

  git(dir, 'checkout', '--', '.')
  rmSync(join(dir, 'evlog.map.json'), { force: true })
})

check('init --dry-run writes nothing', (dir) => {
  const payload = json(cli(dir, ['init', '--json', '--yes', '--dry-run', '--no-install']))
  expect(payload.written.length > 0, 'nothing was planned')
  expect(payload.dryRun === true, 'dryRun was not reported')
  expect(git(dir, 'status', '--porcelain').trim() === '', 'the working tree changed')
})

check('init is idempotent', (dir) => {
  const first = json(cli(dir, ['init', '--json', '--yes', '--no-install']))
  expect(first.written.length > 0, 'nothing was written')
  const second = json(cli(dir, ['init', '--json', '--yes', '--no-install']))
  expect(second.written.length === 0, `the second run wrote ${second.written.length} file(s)`)
  expect(second.already.length > 0, 'the second run reported nothing as already wired')
})

check('init splits dev and production destinations', (dir) => {
  rmSync(join(dir, 'lib/evlog.ts'), { force: true })

  const payload = json(cli(dir, ['init', '--json', '--yes', '--no-install', '--prod-drain', 'axiom,sentry']))
  expect(payload.prodDrains.join() === 'axiom,sentry', `prodDrains were ${payload.prodDrains}`)

  const wired = payload.written.map(file => join(dir, file.file))
    .filter(path => !path.endsWith('.env.example'))
    .map(path => readFileSync(path, 'utf8')).join('\n')
  expect(wired.includes('createFsDrain'), 'the development sink was not wired')
  expect(wired.includes('createAxiomDrain') && wired.includes('createSentryDrain'), 'both production drains were not wired')
  expect(/import\.meta\.dev|NODE_ENV/.test(wired), 'the two were not branched on the environment')
})

check('init writes .env.example, never .env', (dir) => {
  const payload = json(cli(dir, ['init', '--json', '--yes', '--no-install', '--prod-drain', 'axiom']))
  const files = payload.written.map(file => file.file)

  expect(files.includes('.env.example'), 'no .env.example was written')
  expect(!files.includes('.env'), 'a real .env was touched')

  const example = readFileSync(join(dir, '.env.example'), 'utf8')
  expect(example.includes('AXIOM_API_KEY='), 'the adapter keys are missing')
  expect(!/AXIOM_API_KEY=\S/.test(example), 'a value was filled in — init must never write secrets')
})

check('init seeds an error catalog from repeated errors', (dir) => {
  /* Two handlers throwing the same inline error is the evidence that justifies
     a catalog; the generated file should contain the project's own error. */
  const handler = `export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  log.set({ step: 'start' })
  throw createError({ status: 402, message: 'Card declined', why: 'The issuer refused' })
})
`
  write(dir, 'sandbox-a.post.ts', handler)
  write(dir, 'sandbox-b.post.ts', handler)

  const payload = json(cli(dir, ['init', '--json', '--yes', '--no-install', '--extras', 'error-catalog']))
  expect(payload.insight?.repeatedErrors > 0, 'the scan found no repeated error')

  const catalog = payload.written.find(file => file.file.endsWith('errors.ts'))
  if (!catalog) {
    expect(payload.already.some(entry => entry.includes('errors.ts')), 'no catalog written and none reported')
    return
  }
  const contents = readFileSync(join(dir, catalog.file), 'utf8')
  expect(contents.includes('CARD_DECLINED'), 'the key was not derived from the error')
  expect(contents.includes('The issuer refused'), 'the existing why was replaced')
})

check('init verifies with doctor before it finishes', (dir) => {
  const payload = json(cli(dir, ['init', '--json', '--yes', '--no-install']))
  expect(payload.verified !== null, 'no verification ran')
  expect(payload.verified.fail === 0, `doctor reported ${payload.verified.fail} failures after setup`)
})

check('init --drain axiom --extras pipeline', (dir) => {
  /* Set the precondition the check is about: a project with no evlog factory
     yet. The Next fixture ships one, and `init` rightly refuses to touch it —
     which would make this assert "does not overwrite" instead of "wires Axiom".
     That gap has its own check below. */
  rmSync(join(dir, 'lib/evlog.ts'), { force: true })

  const payload = json(cli(dir, ['init', '--json', '--yes', '--no-install', '--drain', 'none', '--prod-drain', 'axiom', '--extras', 'pipeline']))
  expect(payload.prodDrains[0] === 'axiom', `prodDrains were ${payload.prodDrains}`)
  const wired = payload.written.map(file => join(dir, file.file))
    .filter(path => !path.endsWith('.env.example'))
    .map(path => readFileSync(path, 'utf8')).join('\n')
  expect(wired.includes('createAxiomDrain'), 'the Axiom drain was not wired')
  expect(wired.includes('createDrainPipeline'), 'batching was not wired')
  expect(!wired.includes('import.meta.dev'), 'a hosted drain was gated to development')
})

check('init never overwrites, never silently drops a destination', (dir) => {
  /* The two halves of the same promise: a file somebody wrote is left exactly
     as it was, and a destination that was asked for still lands somewhere —
     patched in, written beside it, or handed back as a snippet to paste. */
  write(dir, 'lib/evlog.ts', '// pre-existing\n')
  write(dir, 'server/plugins/evlog-drain.ts', '// pre-existing\n')

  const payload = json(cli(dir, ['init', '--json', '--yes', '--no-install', '--prod-drain', 'axiom']))

  expect(readFileSync(join(dir, 'lib/evlog.ts'), 'utf8') === '// pre-existing\n', 'lib/evlog.ts was modified')
  expect(readFileSync(join(dir, 'server/plugins/evlog-drain.ts'), 'utf8') === '// pre-existing\n', 'the drain plugin was modified')

  const landed = payload.written.some(file => /evlog-drain-|lib\/evlog|(^|\/)evlog\.ts$/.test(file.file))
    || payload.manual.some(step => /destination|factory/i.test(step.title))
  expect(landed, 'Axiom was asked for and went nowhere')
})

check('init --drain none writes no drain', (dir) => {
  const payload = json(cli(dir, ['init', '--json', '--yes', '--no-install', '--drain', 'none']))
  expect(!payload.written.some(file => file.file.includes('evlog-drain')), 'a drain plugin was written')
})

check('init offers nothing it cannot back up', (dir) => {
  /* Batching is meaningless with no production destination, and the AI and auth
     integrations are meaningless without their packages. Asking for them anyway
     drops them rather than wiring something inert. */
  const payload = json(cli(dir, ['init', '--json', '--yes', '--no-install', '--extras', 'pipeline,ai,better-auth']))

  expect(payload.extras.length === 0, `wired ${payload.extras.join(', ')} with nothing to back them`)
  expect(payload.dropped.length === 3, `dropped ${payload.dropped.join(', ')}`)
})

check('init rejects an unknown drain', (dir) => {
  const result = cli(dir, ['init', '--yes', '--drain', 'axium'])
  expect(result.code === 1, `exit code was ${result.code}`)
  expect(result.stderr.includes('Unknown --drain'), 'no explanation printed')
  expect(git(dir, 'status', '--porcelain').trim() === '', 'a rejected run still wrote files')
})

check('init never prompts without a TTY', (dir) => {
  /* The regression that matters most for agents: a run that blocks forever on a
     keystroke nobody is there to press. */
  const result = spawnSync(process.execPath, [CLI, 'init', '--no-install'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, NO_COLOR: '1', EVLOG_TELEMETRY: '0' },
  })
  expect(result.signal !== 'SIGTERM', 'the command hung waiting for input')
  expect((result.status ?? -1) === 0, `exit code was ${result.status}`)
})

check('telemetry status', (dir) => {
  expect(cli(dir, ['telemetry', 'status']).code === 0, 'did not exit 0')
})

/* ── run ────────────────────────────────────────────────────────────────── */

const MAP_ONLY_CHECKS = new Set([
  'doctor --json',
  'map --json --no-write',
  'map --all / map <entry>',
  'map --min-score gates',
  'telemetry status',
])

function checksFor(app) {
  if (!app.mapOnly) return checks
  return checks.filter(({ name }) => MAP_ONLY_CHECKS.has(name))
}

function smokeHeader(apps) {
  const mapOnlyCount = checks.filter(({ name }) => MAP_ONLY_CHECKS.has(name)).length
  const fullCount = checks.length
  const mapOnlyApps = apps.filter(app => app.mapOnly).length
  if (mapOnlyApps === apps.length) {
    return `${mapOnlyCount} checks — ${apps.length} apps`
  }
  if (mapOnlyApps === 0) {
    return `${fullCount} checks — ${apps.length} apps`
  }
  return `${mapOnlyCount} checks (map-only) / ${fullCount} checks (full) — ${apps.length} apps`
}

function smoke(apps) {
  let failed = 0
  process.stderr.write(`\n${bold('smoke')} ${dim(smokeHeader(apps))}\n\n`)

  for (const app of apps) {
    const run = checksFor(app)
    process.stderr.write(`${bold(app.name)}${app.mapOnly ? dim(' (map only — init not supported yet)') : ''}\n`)
    for (const { name, fn } of run) {
      /* A fresh copy per check: `init` writes files, and a check that inherits
         the previous one's leftovers passes or fails for the wrong reason. */
      const dir = createApp(app)
      try {
        fn(dir)
        process.stderr.write(`  ${green('ok')} ${name}\n`)
      } catch (error) {
        failed++
        process.stderr.write(`  ${red('fail')} ${name}\n    ${dim(error.message)}\n`)
      }
    }
    process.stderr.write('\n')
  }

  if (failed > 0) {
    process.stderr.write(`${red(`${failed} check${failed === 1 ? '' : 's'} failed`)}\n`)
    process.exit(1)
  }
  process.stderr.write(`${green('all checks passed')}\n`)
}

function cheatSheet(apps) {
  const lines = [
    '',
    `${bold('sandbox ready')} ${dim(`— ${relative(ROOT, SANDBOX)}/`)}`,
    '',
    dim('Interactive (needs a terminal):'),
    ...apps.map(app => `  ${cyan(`pnpm cli init --cwd .sandbox/${app.name}`)}`),
    '',
    dim('Non-interactive:'),
    `  ${cyan('pnpm cli init --cwd .sandbox/nuxt --yes --drain axiom --extras pipeline,enrichers')}`,
    `  ${cyan('pnpm cli init --cwd .sandbox/next --json --yes --dry-run')}`,
    '',
    dim('Scoring:'),
    `  ${cyan('pnpm cli map --cwd .sandbox/nuxt')}`,
    `  ${cyan('pnpm cli map --cwd .sandbox/nuxt --all')}`,
    `  ${cyan('pnpm cli map --cwd .sandbox/nuxt --min-score 80')}`,
    `  ${cyan('pnpm cli map --cwd .sandbox/nuxt --baseline')}   ${dim('(run map once first, then edit a route)')}`,
    '',
    dim('Diagnosis:'),
    `  ${cyan('pnpm cli doctor --cwd .sandbox/nitro')}`,
    `  ${cyan('pnpm cli doctor --cwd .sandbox/nitro --debug')}`,
    '',
    dim('Undo whatever you ran:'),
    `  ${cyan('pnpm cli:sandbox --reset')}        ${dim('rolls the apps back, keeps them')}`,
    `  ${cyan('pnpm cli:sandbox --reset nuxt')}   ${dim('just that one')}`,
    `  ${cyan('pnpm cli:sandbox')}                ${dim('rebuilds from scratch')}`,
    '',
    dim('Everything under .sandbox/ is disposable and gitignored.'),
    '',
  ]
  process.stderr.write(`${lines.join('\n')}\n`)
}

const args = process.argv.slice(2)
const only = args.find(arg => !arg.startsWith('--'))
const apps = only ? APPS.filter(app => app.name === only) : APPS

if (apps.length === 0) {
  process.stderr.write(`${red(`unknown app "${only}"`)} — try: ${APPS.map(a => a.name).join(', ')}\n`)
  process.exit(2)
}

ensureCliBuilt()
mkdirSync(SANDBOX, { recursive: true })

if (args.includes('--smoke')) {
  smoke(apps)
} else if (args.includes('--reset')) {
  for (const app of apps) resetApp(app)
  process.stderr.write(`${green('ok')} ${dim(`reset ${apps.map(app => app.name).join(', ')}`)}\n`)
} else {
  if (!args.includes('--keep')) for (const app of apps) createApp(app)
  cheatSheet(apps)
}
