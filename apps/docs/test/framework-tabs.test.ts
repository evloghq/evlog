import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const contentDir = join(import.meta.dirname, '../content')
const pages = readdirSync(contentDir, { recursive: true }).filter(file => String(file).endsWith('.md')).map(String)

interface Fence { page: string, line: number, label: string, meta: string, firstLine: string }

function fences(page: string): Fence[] {
  const lines = readFileSync(join(contentDir, page), 'utf8').split('\n')
  const out: Fence[] = []
  let depth: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i]!.match(/^(:{2,})framework-tabs\s*$/)
    if (open) {
      [, depth] = open
      continue
    }
    if (depth && new RegExp(`^${depth}\\s*$`).test(lines[i]!)) {
      depth = undefined
      continue
    }
    const fence = depth && lines[i]!.match(/^```\w*\s*\[([^\]]*)\](.*)$/)
    if (fence) {
      out.push({ page, line: i + 1, label: fence[1]!, meta: fence[2]!.trim(), firstLine: lines[i + 1] ?? '' })
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
})
