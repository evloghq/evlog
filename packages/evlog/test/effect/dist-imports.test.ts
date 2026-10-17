import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../dist')
const entry = join(distDir, 'effect/index.mjs')

/** Every module specifier `file` and the dist chunks it imports load at runtime. */
async function collectImports(file: string, seen = new Set<string>()): Promise<string[]> {
  if (seen.has(file)) return []
  seen.add(file)
  const source = await readFile(file, 'utf8')
  const specifiers = [...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map(match => match[1] ?? '')
  const nested = await Promise.all(specifiers
    .filter(specifier => specifier.startsWith('.'))
    .map(specifier => collectImports(resolve(dirname(file), specifier), seen)))
  return [...specifiers, ...nested.flat()]
}

describe.skipIf(!existsSync(entry))('evlog/effect dist entry', () => {
  it('loads without node:async_hooks, so it runs on Workers without nodejs_compat', async () => {
    const imports = await collectImports(entry)
    expect(imports).toContain('effect')
    expect(imports.some(specifier => specifier.includes('async_hooks'))).toBe(false)
  })
})
