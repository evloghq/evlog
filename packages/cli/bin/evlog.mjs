#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE = '@evlog/cli'

const self = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(self, 'package.json'), 'utf8'))

const parts = version => version.split('-')[0].split('.').map(Number)

function atLeast(version, floor) {
  const [have, need] = [parts(version), parts(floor)]
  const at = have.findIndex((part, index) => part !== need[index])
  return at === -1 || have[at] > need[at]
}

/* The lowest version a range accepts. `engines.node` is a floor, `>=x.y.z`. The
   evlog peer range is one floor per major, `^2.31.0 || >=3.0.0-beta.0`, and its
   alternatives meet end to end, so the lowest one is the floor of the whole range. */
function floorOf(range) {
  return range.split('||').map(part => part.trim().replace(/^(\^|>=)/, '')).reduce((low, next) => atLeast(next, low) ? low : next)
}

/* A prerelease counts as its release, so a 3.0.0 beta meets `>=3.0.0`. */
function meets(version, range) {
  return atLeast(version, floorOf(range))
}

/* The install that resolves from the cwd wins over a global copy. The realpath
   check ends the hand-off when that install is this copy. A package.json that
   does not parse stops the lookup the way a missing install does. */
function installed() {
  try {
    return dirname(dirname(createRequire(join(process.cwd(), 'package.json')).resolve(PACKAGE)))
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_INVALID_PACKAGE_CONFIG') throw error
    return null
  }
}

/* What is wrong with the evlog this copy imports, if anything. An older one
   lacks exports the commands import, and Node reports that as a syntax error.
   Its manifest is found from its entry, since older versions do not export it. */
function evlogProblem() {
  const range = manifest.peerDependencies.evlog
  const needs = `${PACKAGE} ${manifest.version} needs evlog ${floorOf(range)} or later`
  let root
  try {
    root = dirname(fileURLToPath(import.meta.resolve('evlog')))
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    return `${needs}, and none is installed next to it\n→ Install evlog where ${PACKAGE} is installed, then run the command again`
  }
  while (!existsSync(join(root, 'package.json'))) root = dirname(root)
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (meets(version, range)) return null
  return `${needs}, and the one it loads is evlog ${version} (${root})\n→ Update it, then run the command again`
}

function stop(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

const local = installed()

if (!meets(process.versions.node, manifest.engines.node)) {
  stop(`${PACKAGE} needs Node.js ${floorOf(manifest.engines.node)} or later, and this is Node.js ${process.versions.node}`)
} else if (local && realpathSync(local) !== realpathSync(self)) {
  const { bin } = JSON.parse(readFileSync(join(local, 'package.json'), 'utf8'))
  await import(pathToFileURL(join(local, bin.evlog)).href)
} else {
  const problem = evlogProblem()
  if (problem) stop(problem)
  else await import('../dist/cli.mjs')
}
