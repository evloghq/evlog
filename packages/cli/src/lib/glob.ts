import { globSync } from 'node:fs'
import { basename, join } from 'node:path'

/*
 * Directories no scan enters, plus declaration files. Node hands `exclude`
 * either a bare name or a relative path depending on depth, so the test is on
 * the last segment only.
 */
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.turbo',
  '.nuxt',
  '.next',
  '.svelte-kit',
  '.vercel',
  '.output',
  'coverage',
])

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
  return [...new Set(matches)].sort().map(file => join(cwd, file))
}
