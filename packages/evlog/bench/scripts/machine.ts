/**
 * Records the machine that produced `bench/baseline/bench.json`.
 *
 * `pnpm run bench` runs it right after copying the results, so the machine
 * shown in `RESULTS.md` is always the one that recorded the numbers.
 *
 * Usage:
 *   tsx bench/scripts/machine.ts
 */

import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { arch, availableParallelism, cpus, release, totalmem, type } from 'node:os'

const require = createRequire(import.meta.url)

const machine = {
  recordedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runner: process.env.GITHUB_ACTIONS ? 'GitHub Actions runner' : 'local machine, not the GitHub Actions runner used by CI',
  node: process.version,
  cpu: cpus()[0]!.model.trim(),
  vcpu: availableParallelism(),
  os: `${type()} ${release()} ${arch()}`,
  memTotalKiB: Math.round(totalmem() / 1024),
  vitest: (require('vitest/package.json') as { version: string }).version,
  command: 'pnpm run bench (vitest bench bench/core/)',
}

const outPath = new URL('../baseline/machine.json', import.meta.url)
await writeFile(outPath, `${JSON.stringify(machine, null, 2)}\n`)
console.log('Machine written to bench/baseline/machine.json')
