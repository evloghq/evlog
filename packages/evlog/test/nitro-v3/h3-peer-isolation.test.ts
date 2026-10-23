import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const v3Plugin = resolve(__dirname, '../../dist/nitro/plugin.mjs')
const distExists = existsSync(v3Plugin)

if (!distExists) {
  console.warn('[evlog test] Skipping h3 peer isolation: dist/ not found. Run `pnpm --filter evlog run build` first.')
}

// h3 is legitimately imported by the v2 runtime chunks, so it can't be forbidden
// dist-wide. Collect the chunks the v3 plugin actually reaches (it pulls in
// shared root-level chunks via `../*.mjs`) and forbid h3 only within that set.
function collectV3Chunks(entry: string): string[] {
  const seen = new Set<string>()
  const relativeRe = /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g

  const walk = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      return
    }
    let match: RegExpExecArray | null
    while ((match = relativeRe.exec(source))) {
      walk(resolve(dirname(file), match[1] ?? match[2]))
    }
  }

  walk(entry)
  return [...seen]
}

/**
 * Regression: the v3 plugin reused `extendDeferredDrain` from `nitro/enrich-drain`,
 * which imports `getHeaders` from the optional `h3` peer for the v2 runtime. v3
 * consumers without a direct `h3` dependency hit the stubbed optional peer and
 * failed to build with `"getHeaders" is not exported by "__vite-optional-peer-dep:h3:evlog"`.
 * No chunk in the v3 plugin's graph may import `h3`.
 */
describe.skipIf(!distExists)('evlog/nitro avoids the optional h3 peer', () => {
  it('no chunk reachable from the v3 plugin imports h3', () => {
    const chunks = collectV3Chunks(v3Plugin)
    expect(chunks.length).toBeGreaterThan(0)

    const forbidden = [
      'from "h3"',
      'from \'h3\'',
      'import("h3")',
      'import(\'h3\')',
    ]

    for (const file of chunks) {
      const src = readFileSync(file, 'utf8')
      for (const needle of forbidden) {
        expect(src, file).not.toContain(needle)
      }
    }
  })
})
