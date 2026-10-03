import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { DrainContext, WideEvent } from 'evlog'
import { initLogger } from 'evlog'
import { createMiddlewareLogger } from 'evlog/toolkit'
import type { EvaluationModel } from '../src/evaluate'
import type { SignalColumn, SignalsPlugin } from '../src/plugin'
import { createSignals } from '../src/plugin'
import { catalog } from './catalog'
import { fixtures } from './fixtures'
import { mockEvaluate } from './mock'

const USAGE = `Usage: tsx scripts/demo.ts [--mock] [--all] [--pretty] [--events <file.ndjson>]

  --mock      scripted answers, no key needed (labelled as such)
  --all       sample 100% so every column shows; default samples info at 0% to show promotion
  --pretty    let evlog print each drained event
  --events    replay wide events from an NDJSON file (an fs drain output) instead of the fixtures

Live runs need AI_GATEWAY_API_KEY, or VERCEL_OIDC_TOKEN from vercel env pull.`

const args = new Set(process.argv.slice(2))
const eventsFile = args.has('--events') ? process.argv[process.argv.indexOf('--events') + 1] : undefined
if (args.has('--help') || (args.has('--events') && !eventsFile)) {
  console.log(USAGE)
  process.exit(args.has('--help') ? 0 : 1)
}

const PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000

function resolveModel(): { model?: EvaluationModel, label: string } {
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) return { label: 'typesafe-ai/jev via AI Gateway' }
  console.error(`No key found.\n\n${USAGE}`)
  process.exit(1)
}

function column(value: SignalColumn): string {
  const v = typeof value.value === 'boolean' ? (value.value ? 'yes' : 'no') : value.value
  const confidence = value.confidence === undefined ? '' : ` ${value.confidence.toFixed(2)}`
  return `${v}${confidence}${value.kept ? ' kept' : ''}`
}

function formatSignals(event: WideEvent): string {
  const signals = event.signals as Record<string, SignalColumn> | undefined
  if (!signals) return '-'
  return Object.entries(signals).map(([name, verdict]) => `${name}=${column(verdict)}`).join('  ')
}

async function replay(plugin: SignalsPlugin, file: string): Promise<number> {
  let count = 0
  for await (const line of createInterface({ input: createReadStream(file) })) {
    if (!line.trim()) continue
    const event = JSON.parse(line) as WideEvent
    delete event.signals
    delete event.signalsModel
    await plugin.enrich!({ event, request: { path: String(event.path ?? '') } })
    count++
    console.log(`${String(event.method ?? '').padEnd(5)} ${String(event.path ?? '').padEnd(32)} ${String(event.status ?? '').padEnd(4)} ${formatSignals(event)}`)
  }
  return count
}

async function runFixtures(plugin: SignalsPlugin, pretty: boolean, sampleAll: boolean): Promise<void> {
  const drained = new Map<string, WideEvent>()
  initLogger({
    pretty,
    silent: !pretty,
    sampling: { rates: { info: sampleAll ? 100 : 0 } },
    drain: ({ event }: DrainContext) => {
      drained.set(String(event.requestId), event)
    },
  })

  for (const fixture of fixtures) {
    const { logger, finish } = createMiddlewareLogger({
      method: fixture.method,
      path: fixture.path,
      requestId: fixture.label,
      plugins: [plugin],
    })
    logger.set(fixture.fields)
    const realNow = Date.now
    if (fixture.durationMs) Date.now = () => realNow() + fixture.durationMs!
    try {
      await finish(fixture.error ? { error: fixture.error } : { status: fixture.status })
    } finally {
      Date.now = realNow
    }
  }

  console.log(`\n${'request'.padEnd(22)} ${'status'.padEnd(6)} ${'outcome'.padEnd(26)} signals`)
  console.log('-'.repeat(110))
  for (const fixture of fixtures) {
    const event = drained.get(fixture.label)
    const status = fixture.error ? (fixture.error as { statusCode?: number }).statusCode : fixture.status
    let outcome = 'sampled out'
    if (event) {
      const keptBy = Object.entries((event.signals as Record<string, SignalColumn> | undefined) ?? {}).find(([, v]) => v.kept)?.[0]
      outcome = keptBy ? `kept by ${keptBy}` : event.audit ? 'kept (audit)' : event.level === 'error' ? 'kept (error)' : 'kept (sampling)'
    }
    console.log(`${fixture.label.padEnd(22)} ${String(status).padEnd(6)} ${outcome.padEnd(26)} ${event ? formatSignals(event) : '-'}`)
  }
  console.log(`\n${fixtures.length} requests, info sampled at ${sampleAll ? 100 : 0}%: ${drained.size} drained`)
}

const { model, label } = args.has('--mock') ? { label: 'mock answers (not the model)' } : resolveModel()
const plugin = createSignals({
  signals: catalog,
  model,
  evaluate: args.has('--mock') ? mockEvaluate : undefined,
  providerOptions: { gateway: { zeroDataRetention: true } },
})

console.log(`evlog signals demo: ${catalog.length} signals, ${label}\n`)
const started = Date.now()
if (eventsFile) {
  const count = await replay(plugin, eventsFile)
  console.log(`\n${count} events replayed from ${eventsFile}`)
} else {
  await runFixtures(plugin, args.has('--pretty'), args.has('--all'))
}

const stats = plugin.stats()
console.log(`model calls ${stats.calls}, cached ${stats.cached}, skipped ${stats.skipped}, errors ${stats.errors}, input tokens ${stats.inputTokens}`)
console.log(`estimated cost $${(stats.inputTokens * PRICE_PER_INPUT_TOKEN).toFixed(5)} at $0.042/M input tokens, ${Date.now() - started}ms wall time`)
