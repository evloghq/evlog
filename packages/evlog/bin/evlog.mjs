#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, delimiter, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PACKAGE = '@evlog/cli'
/* Set on the fetch so that, when the evlog bin shadows @evlog/cli, the run it
   starts does not fetch again. */
const GUARD = 'EVLOG_CLI_WRAPPER'

/* pnpm 11 links packages from a global store, so in `pnpm dlx` this bin cannot
   see the @evlog/cli installed next to it. The node_modules/.bin that launched
   it can. */
function launchers() {
  return (process.env.PATH ?? '').split(delimiter)
    .filter(dir => basename(dir) === '.bin' && basename(dirname(dir)) === 'node_modules')
    .map(dir => join(dir, '..', '..', 'package.json'))
}

/* The project's own install wins over a hoisted one, so an app that pins the
   CLI in a monorepo runs that pin. The package exports a single entry, so its
   root is found from there and the executable is read from its manifest. */
function locate() {
  for (const from of [join(process.cwd(), 'package.json'), import.meta.url, ...launchers()]) {
    try {
      return dirname(dirname(createRequire(from).resolve(PACKAGE)))
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error
    }
  }
  return null
}

function runner() {
  const agent = process.env.npm_config_user_agent ?? ''
  if (agent.startsWith('pnpm')) return ['pnpm', ['dlx']]
  if (agent.startsWith('bun')) return ['bunx', []]
  if (agent.startsWith('yarn')) return ['yarn', ['dlx']]
  return ['npx', ['--yes']]
}

const root = locate()

if (root) {
  const { bin } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  await import(pathToFileURL(join(root, bin.evlog)).href)
} else if (process.env[GUARD]) {
  process.stderr.write(`${PACKAGE} could not be loaded from the fetch that was just started. Run it with npx instead: npx --yes ${PACKAGE} <command>\n`)
  process.exitCode = 1
} else {
  const [command, prefix] = runner()
  process.stderr.write(`${PACKAGE} is not installed, fetching it with ${command}. Add it as a dev dependency for a pinned, instant run.\n`)
  const result = spawnSync(command, [...prefix, PACKAGE, ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, [GUARD]: '1' },
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
