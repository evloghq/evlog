export interface EventStep {
  id: string
  /** What the reader added to get here, such as `log.set()`. */
  label: string
  /** Terminal output of this step, one entry per line, with the ANSI codes evlog wrote. */
  pretty: string[]
  /** `null` when evlog emitted nothing, with `dropped` saying why. */
  event: Record<string, unknown> | null
  dropped?: string
}

export interface EventScenario {
  scenario: string
  /** The entry point that produced the event: an integration, or `evlog` for a script. */
  via: string
  evlog: string
  steps: EventStep[]
}

/** Captured by `pnpm --filter evlog-docs-next capture`. Never edit the JSON by hand. */
export const eventScenarios: Record<string, EventScenario> = Object.fromEntries(
  Object.values(import.meta.glob<EventScenario>('../data/events/*.json', { eager: true, import: 'default' }))
    .map(scenario => [scenario.scenario, scenario]),
)

export type EventTone = 'plain' | 'dim' | 'key' | 'ok' | 'warn' | 'error'

export const eventToneClass: Record<EventTone, string> = {
  plain: 'text-default',
  dim: 'text-dimmed',
  key: 'text-(--d-out-key)',
  ok: 'text-(--d-out-ok)',
  warn: 'text-(--d-out-warn)',
  error: 'text-(--d-out-error)',
}

export interface EventSpan {
  text: string
  tone: EventTone
  bold: boolean
}

export interface EventLine {
  /** Stable across steps, so a line that stays keeps its place while others move around it. */
  key: string
  /** The top-level field the line belongs to, or `head` for the request line. */
  field: string
  spans: EventSpan[]
  /** Not in the step before. */
  added: boolean
}

// The colours evlog writes to a terminal, by role.
const tones: Record<string, EventTone> = { 2: 'dim', 90: 'dim', 36: 'key', 32: 'ok', 33: 'warn', 31: 'error' }

const SGR = /\u001B\[(\d+)m/g

export function parseAnsi(line: string): EventSpan[] {
  const spans: EventSpan[] = []
  let tone: EventTone = 'plain'
  let bold = false
  let from = 0
  for (const match of line.matchAll(SGR)) {
    if (match.index > from) spans.push({ text: line.slice(from, match.index), tone, bold })
    from = match.index + match[0].length
    const code = match[1]!
    if (code === '0') {
      tone = 'plain'
      bold = false
    } else if (code === '1') {
      bold = true
    } else {
      tone = tones[code] ?? tone
    }
  }
  if (from < line.length) spans.push({ text: line.slice(from), tone, bold })
  return spans
}

/**
 * Names each line by its text without colour or tree glyphs, so `├─ user:` and `└─ user:` are the
 * same line, and by the field it sits under: a `├─ key:` line opens a field, the lines below belong to it.
 */
function keyed(lines: string[]) {
  const seen = new Map<string, number>()
  let field = 'head'
  return lines.map((line, index) => {
    const text = line.replace(SGR, '')
    const opens = text.match(/^\s*[├└]─ ([^:]+):/)
    if (opens) field = opens[1]!
    const id = index === 0 ? 'head' : text.replace(/[├└│─]/g, '').trim()
    const count = seen.get(id) ?? 0
    seen.set(id, count + 1)
    return { line, key: `${id}#${count}`, field }
  })
}

export function prettyLines(steps: EventStep[], index: number): EventLine[] {
  const before = new Set(index > 0 ? keyed(steps[index - 1]!.pretty).map(entry => entry.key) : [])
  return keyed(steps[index]!.pretty).map(({ line, key, field }) => ({
    key,
    field,
    spans: parseAnsi(line),
    added: index > 0 && field !== 'head' && !before.has(key),
  }))
}

export function jsonLines(steps: EventStep[], index: number): EventLine[] {
  const { event } = steps[index]!
  if (!event) return []
  const previous = index > 0 ? steps[index - 1]!.event ?? {} : undefined
  const lines: EventLine[] = [{ key: '{', field: 'head', spans: [{ text: '{', tone: 'dim', bold: false }], added: false }]
  const entries = Object.entries(event)
  entries.forEach(([field, value], at) => {
    const added = previous !== undefined && !(field in previous)
    const text = JSON.stringify(value, null, 2).split('\n')
    text.forEach((part, row) => {
      const last = row === text.length - 1
      const comma = last && at < entries.length - 1 ? ',' : ''
      const tone = field === 'error' ? 'error' : 'plain'
      const spans: EventSpan[] = row === 0
        ? [{ text: `  "${field}"`, tone: 'key', bold: false }, { text: ': ', tone: 'dim', bold: false }, { text: part + comma, tone, bold: false }]
        : [{ text: `  ${part}${comma}`, tone, bold: false }]
      lines.push({ key: `${field}#${row}`, field, spans, added })
    })
  })
  lines.push({ key: '}', field: 'head', spans: [{ text: '}', tone: 'dim', bold: false }], added: false })
  return lines
}
