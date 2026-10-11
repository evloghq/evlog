#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE = '@evlog/cli'

/* The install that resolves from the cwd wins over a global copy. The realpath
   check ends the hand-off when that install is this copy. */
function installed() {
  try {
    return dirname(dirname(createRequire(join(process.cwd(), 'package.json')).resolve(PACKAGE)))
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
    return null
  }
}

const self = dirname(dirname(fileURLToPath(import.meta.url)))
const local = installed()

if (local && realpathSync(local) !== realpathSync(self)) {
  const { bin } = JSON.parse(readFileSync(join(local, 'package.json'), 'utf8'))
  await import(pathToFileURL(join(local, bin.evlog)).href)
} else {
  await import('../dist/cli.mjs')
}
