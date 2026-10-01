#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PACKAGE = '@evlog/cli'

/* The project's own install wins over a hoisted one, so an app that pins the
   CLI in a monorepo runs that pin. The package exports a single entry, so its
   root is found from there and the executable is read from its manifest. */
function locate() {
  for (const from of [join(process.cwd(), 'package.json'), import.meta.url]) {
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
} else {
  const [command, prefix] = runner()
  process.stderr.write(`${PACKAGE} is not installed, fetching it with ${command}. Add it as a dev dependency for a pinned, instant run.\n`)
  const result = spawnSync(command, [...prefix, PACKAGE, ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
