import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { scenarios } from './scenarios/index.ts'

export interface CapturedStep {
  id: string
  label: string
  /** Terminal output, one entry per line, with the ANSI codes evlog wrote. */
  pretty: string[]
  /** `null` when evlog emitted nothing, with `dropped` saying why. */
  event: Record<string, unknown> | null
  dropped?: string
}

export interface CapturedScenario {
  scenario: string
  /** The entry point that produced the event: an integration, or `evlog` for a script. */
  via: string
  evlog: string
  steps: CapturedStep[]
}

const root = import.meta.dirname
const scenariosDir = resolve(root, 'scenarios')

// The clock and the machine are the only things that differ between two runs. Both are pinned, so a
// change in a captured file is a change in evlog or in a scenario.
const TIMESTAMP = '2027-01-18T10:23:45.612Z'
const DURATION_MS = 234

function pin(text: string) {
  return text
    .replaceAll(`${pathToFileURL(scenariosDir).href}/`, '')
    .replaceAll(`${scenariosDir}/`, '')
    .replace(/\d{2}:\d{2}:\d{2}\.\d{3}/, TIMESTAMP.slice(11, 23))
    .replace(/in \d+ms/, `in ${DURATION_MS}ms`)
}

const foreign = ['/scripts/play.ts', 'node:internal', '/node_modules/', '/packages/evlog/dist/']

/**
 * Drops the stack frames of this harness, of Node and of dependencies, which the reader's app would
 * not have. The pretty printer lists such frames under a `stack` heading, which goes with them when
 * none is left.
 */
function ownFrames(stack: string) {
  const lines = stack.split('\n').filter(line => !foreign.some(marker => line.includes(marker)))
  const heading = lines.findIndex(line => /\u001B\[90mstack\u001B\[0m$/.test(line))
  if (heading > 0 && !/\u001B\[90m\s+at /.test(lines[heading + 1] ?? '')) lines.splice(heading - 1, 2)
  return lines.join('\n')
}

const { version } = JSON.parse(readFileSync(resolve(root, '../../../packages/evlog/package.json'), 'utf8'))

export function captureScenario(name: string): CapturedScenario {
  const scenario = scenarios[name]
  if (!scenario) throw new Error(`Unknown scenario: ${name}`)

  const steps = scenario.steps.map((step) => {
    const run = spawnSync(process.execPath, [resolve(root, 'play.ts'), name, step.id], {
      cwd: scenariosDir,
      encoding: 'utf8',
      // evlog reads the service, the commit and the region from the environment, and CI sets some of them.
      env: { PATH: process.env.PATH, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    })
    if (run.status !== 0) throw new Error(`${name} ${step.id} exited ${run.status}: ${run.stderr}`)

    const event = JSON.parse(run.output[3]!)
    if (event) {
      event.timestamp = TIMESTAMP
      event.durationMs = DURATION_MS
      event.duration = `${DURATION_MS}ms`
      if (event.error?.stack) event.error.stack = pin(ownFrames(event.error.stack))
    }

    // evlog derives an audit event's idempotency key from its timestamp, so it is pinned with it.
    const key = event?.audit?.idempotencyKey
    const pinnedKey = key && createHash('sha256').update(JSON.stringify({ ...event.audit, idempotencyKey: TIMESTAMP })).digest('hex').slice(0, key.length)
    if (key) event.audit.idempotencyKey = pinnedKey

    const printed = pin(ownFrames(run.stdout)).replaceAll(key ?? TIMESTAMP, pinnedKey ?? TIMESTAMP).trimEnd()
    return { id: step.id, label: step.label, pretty: printed ? printed.split('\n') : [], event, dropped: step.dropped }
  })

  return { scenario: name, via: scenario.via, evlog: version, steps }
}

export function serialize(captured: CapturedScenario) {
  return `${JSON.stringify(captured, null, 2)}\n`
}
