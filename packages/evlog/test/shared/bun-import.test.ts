import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const bunAvailable = spawnSync('bun', ['--version']).status === 0

describe.skipIf(!bunAvailable)('Bun integration imports', () => {
  it.each([
    ['top-level await', ['run', fileURLToPath(new URL('./fixtures/bun-import.mjs', import.meta.url))]],
    ['test lifecycle hooks', ['test', '--timeout', '1000', fileURLToPath(new URL('./fixtures/bun-import.test.mjs', import.meta.url))]],
  ])('preserves the async context for %s', (_, args) => {
    const result = spawnSync('bun', args, { encoding: 'utf8', timeout: 10_000 })

    expect(result.error).toBeUndefined()
    expect(result.signal, result.stderr).toBeNull()
    expect(result.status, result.stderr).toBe(0)
  })
})
