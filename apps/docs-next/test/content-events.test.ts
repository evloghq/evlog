import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scenarios } from '../scripts/scenarios/index'

const contentDir = resolve(import.meta.dirname, '../content')
const scenariosDir = resolve(import.meta.dirname, '../scripts/scenarios')

interface EmitsBlock {
  page: string
  scenario: string
  step: string
  /** Each snippet of the reader's code the block shows, as lines. */
  snippets: string[][]
}

/**
 * The TypeScript a block shows as the reader's own code. Inside `framework-tabs` that is the Hono tab,
 * the one framework the scenarios run. Output fences (JSON, bash) are not code that ran.
 */
function snippetsOf(body: string) {
  const fences = [...body.matchAll(/^```(\w+) ([^\n]*)\n([\s\S]*?)\n```$/gm)]
    .filter(([, lang]) => lang === 'typescript' || lang === 'ts')
  const shown = body.includes(':::framework-tabs') ? fences.filter(([,, label]) => label!.startsWith('[Hono]')) : fences
  return shown.map(([,,, code]) => code!.split('\n'))
}

function emitsBlocks(): EmitsBlock[] {
  const blocks: EmitsBlock[] = []
  for (const page of readdirSync(contentDir, { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.md'))) {
    const source = readFileSync(resolve(contentDir, page), 'utf8')
    const scenario = source.match(/^event: (\S+)$/m)?.[1] ?? ''
    for (const [, step, body] of source.matchAll(/^::emits\{step="([^"]+)"\}\n([\s\S]*?)\n::$/gm)) {
      blocks.push({ page, scenario, step: step!, snippets: snippetsOf(body!) })
    }
  }
  return blocks
}

/** A scenario file imports its neighbours with the `.ts` extension Node needs; a page leaves it out. */
function meaningful(lines: string[]) {
  return lines.map(line => line.trim().replace(/(from '\.[^']*)\.ts'/, '$1\'')).filter(Boolean)
}

/** The first line of `snippet` that `file` does not have, reading both in order. */
function firstMissing(snippet: string[], file: string[]) {
  let from = 0
  for (const line of snippet) {
    const at = file.indexOf(line, from)
    if (at === -1) return line
    from = at + 1
  }
}

/** Every file of the reader's app at a step: the code that ran, what it imports, and the config. */
function filesOf(scenario: string, id: string) {
  const { config, steps } = scenarios[scenario]!
  const step = steps.find(candidate => candidate.id === id)!
  return [step.file, ...step.also ?? [], step.config ?? config]
    .map(file => meaningful(readFileSync(resolve(scenariosDir, file), 'utf8').split('\n')))
}

const blocks = emitsBlocks()
const snippets = blocks.flatMap(block => block.snippets.map((code, index) => ({ ...block, index, code: meaningful(code) })))

describe('::emits blocks', () => {
  it('are found', () => {
    expect(blocks.length).toBeGreaterThan(0)
    expect(snippets.length).toBeGreaterThan(0)
  })

  it.each(blocks)('$page $step names a step of the scenario in the page frontmatter', ({ scenario, step }) => {
    expect(scenarios[scenario]?.steps.map(candidate => candidate.id)).toContain(step)
  })

  // A page excerpts a file that was run: it may leave lines out, never add or change one.
  it.each(snippets)('$page $step snippet $index is taken from a file that was run', ({ scenario, step, code }) => {
    expect(code.length).toBeGreaterThan(0)
    const missing = filesOf(scenario, step).map(file => firstMissing(code, file))
    expect(missing, `no scenario file has the line: ${missing[0]}`).toContain(undefined)
  })
})
