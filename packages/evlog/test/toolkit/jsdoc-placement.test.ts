import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../../src')

describe('JSDoc placement', () => {
  // TypeScript attaches only the last of two adjacent JSDoc blocks to the declaration,
  // so the first one never reaches the published types or the editor hover.
  it('never stacks a JSDoc block directly on another one', () => {
    const stacked: string[] = []
    for (const file of readdirSync(srcDir, { recursive: true, encoding: 'utf8' })) {
      if (!file.endsWith('.ts')) continue
      const lines = readFileSync(join(srcDir, file), 'utf8').split('\n')
      lines.forEach((line, i) => {
        const closesBlock = line.trim() === '*/' || /^\s*\/\*\*.*\*\/\s*$/.test(line)
        if (closesBlock && lines[i + 1]?.trim().startsWith('/**')) stacked.push(`${file}:${i + 1}`)
      })
    }
    expect(stacked).toEqual([])
  })
})
