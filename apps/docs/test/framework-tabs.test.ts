import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const contentDir = join(import.meta.dirname, '../content')
const pages = readdirSync(contentDir, { recursive: true }).filter(file => String(file).endsWith('.md')).map(String)

interface Fence { page: string, block: number, line: number, label: string, meta: string, firstLine: string, body: string }

function fences(page: string): Fence[] {
  const lines = readFileSync(join(contentDir, page), 'utf8').split('\n')
  const out: Fence[] = []
  let depth: string | undefined
  let block = 0
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i]!.match(/^(:{2,})framework-tabs\s*$/)
    if (open) {
      [, depth] = open
      block++
      continue
    }
    if (depth && new RegExp(`^${depth}\\s*$`).test(lines[i]!)) {
      depth = undefined
      continue
    }
    const fence = depth && lines[i]!.match(/^```\w*\s*\[([^\]]*)\](.*)$/)
    if (fence) {
      const end = lines.indexOf('```', i + 1)
      const body = lines.slice(i + 1, end === -1 ? undefined : end)
      out.push({ page, block, line: i + 1, label: fence[1]!, meta: fence[2]!.trim(), firstLine: body[0] ?? '', body: body.join('\n') })
    }
  }
  return out
}

const all = pages.flatMap(fences)

// The header shows the fence meta as the file path; a path left in the body
// would print twice.
describe('framework tabs', () => {
  it('keep the file path in the fence meta, not in a body comment', () => {
    const offenders = all.filter(f => /^\/\/ [\w./@-]+\.\w+\s*$/.test(f.firstLine))
    expect(offenders.map(f => `${f.page}:${f.line}`)).toEqual([])
  })

  // Nuxt keeps Nitro v2's auto-imports; a Nitro tab documents Nitro v3.
  it('write Nitro tabs against Nitro v3', () => {
    const offenders = all.filter(f => f.label === 'Nitro' && /defineNitroPlugin|defineEventHandler|useLogger \} from 'evlog'$/m.test(f.body))
    expect(offenders.map(f => `${f.page}:${f.line}`)).toEqual([])
  })

  it('use a meta MDC can parse', () => {
    const offenders = all.filter(f => /[[\]{}]/.test(f.meta))
    expect(offenders.map(f => `${f.page}:${f.line} ${f.meta}`)).toEqual([])
  })

  // Node.js searchers mostly don't use a framework, so this page opens on the
  // plain node:http example; other pages keep the house order.
  it('open the Node.js guide on Standalone', () => {
    const page = '5.use-cases/6.structured-logging-nodejs.md'
    const firsts = all.filter(f => f.page === page).filter((f, i, list) => i === 0 || list[i - 1]!.block !== f.block)
    expect(firsts.length).toBeGreaterThan(0)
    expect(firsts.map(f => f.label)).toEqual(firsts.map(() => 'Standalone'))
  })
})
