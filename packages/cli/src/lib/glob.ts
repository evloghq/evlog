import { globSync } from 'node:fs'
import { basename, join, sep } from 'node:path'

/*
 * Directories no scan enters at any depth, plus declaration files. Node hands
 * `exclude` either a bare name or a relative path depending on depth and on
 * its version, so the test is on the last segment only.
 */
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  '.nuxt',
  '.next',
  '.svelte-kit',
  '.vercel',
  '.output',
])

/*
 * Build output, skipped at the project root only: `server/api/build/` is a
 * route directory. `exclude` cannot tell the two apart, so these are dropped
 * from the matches instead.
 */
const SKIPPED_AT_ROOT = new Set(['dist', 'build', 'coverage'])

function skipped(entry: string): boolean {
  const name = basename(entry)
  return SKIPPED_DIRS.has(name) || name.endsWith('.d.ts')
}

/**
 * Absolute paths matching `patterns` under `cwd`, deduplicated and sorted so
 * a scan reads files in the same order on every machine.
 */
export function glob(patterns: string | readonly string[], cwd: string): string[] {
  const matches = globSync(typeof patterns === 'string' ? patterns : [...patterns], { cwd, exclude: skipped })
    .filter(file => !SKIPPED_AT_ROOT.has(file.split(sep)[0]!))
  return [...new Set(matches)].sort().map(file => join(cwd, file))
}
