/**
 * Load scenarios for the request path and the drain pipeline, run against one
 * or more built evlog packages so versions compare on the same machine.
 *
 * Each scenario runs in a fresh Node process: the shutdown registry, signal
 * listeners and serverless detection are process-wide.
 *
 * Usage:
 *   tsx bench/load/load.ts                                      # this package's dist
 *   tsx bench/load/load.ts --pkg 2.36.0=/tmp/evlog-2.36.0 --pkg head=.
 *   tsx bench/load/load.ts --only steady --repeat 3 --json out.json
 */

import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

type Mode = 'node' | 'node-waituntil' | 'serverless'
type Failure = 'none' | 'retryable' | 'rejected' | 'retry-after'

interface Scenario {
  name: string
  /** `hot`: sequential requests with no handler delay. `open`: a fixed arrival rate. */
  kind: 'hot' | 'open'
  mode: Mode
  drain: boolean
  requests?: number
  rate?: number
  durationMs?: number
  handlerMs?: [number, number]
  backendMs?: number
  failure?: Failure
}

interface Result {
  scenario: string
  pkg: string
  version: string
  nsPerRequest?: number
  achievedRps?: number
  cpuPct: number
  eldP99Ms: number
  eldMaxMs: number
  heapPeakMB: number
  heapAfterGcMB: number
  rssPeakMB: number
  overheadP50Ms?: number
  overheadP99Ms?: number
  waitUntilP50Ms?: number
  waitUntilP99Ms?: number
  waitUntilOpenAtEnd?: number
  delivered: number
  sends: number
  dropped: Record<string, number>
  backlogAtEnd: number
  flushMs: number
}

const SCENARIOS: Scenario[] = [
  { name: 'hot: no drain', kind: 'hot', mode: 'node', drain: false, requests: 200_000 },
  { name: 'hot: pipeline', kind: 'hot', mode: 'node', drain: true, requests: 200_000 },
  { name: 'hot: pipeline + waitUntil', kind: 'hot', mode: 'node-waituntil', drain: true, requests: 200_000 },
  { name: 'hot: serverless', kind: 'hot', mode: 'serverless', drain: true, requests: 200_000 },
  { name: 'steady 5k rps, 2k concurrent', kind: 'open', mode: 'node', drain: true, rate: 5000, durationMs: 10_000, handlerMs: [200, 600], backendMs: 5 },
  { name: 'steady 5k rps + waitUntil', kind: 'open', mode: 'node-waituntil', drain: true, rate: 5000, durationMs: 10_000, handlerMs: [200, 600], backendMs: 5 },
  { name: 'serverless 2k rps', kind: 'open', mode: 'serverless', drain: true, rate: 2000, durationMs: 10_000, handlerMs: [20, 100], backendMs: 5 },
  { name: 'slow backend 300ms', kind: 'open', mode: 'node', drain: true, rate: 2000, durationMs: 10_000, handlerMs: [20, 100], backendMs: 300 },
  { name: 'slow backend + waitUntil', kind: 'open', mode: 'node-waituntil', drain: true, rate: 2000, durationMs: 10_000, handlerMs: [20, 100], backendMs: 300 },
  { name: 'failing backend (503)', kind: 'open', mode: 'node', drain: true, rate: 2000, durationMs: 10_000, handlerMs: [20, 100], backendMs: 20, failure: 'retryable' },
  { name: 'failing backend + waitUntil', kind: 'open', mode: 'node-waituntil', drain: true, rate: 2000, durationMs: 10_000, handlerMs: [20, 100], backendMs: 20, failure: 'retryable' },
  { name: 'rejecting backend (400)', kind: 'open', mode: 'node', drain: true, rate: 2000, durationMs: 10_000, handlerMs: [20, 100], backendMs: 20, failure: 'rejected' },
  { name: 'rate-limited (Retry-After 60s)', kind: 'open', mode: 'node', drain: true, rate: 2000, durationMs: 10_000, handlerMs: [20, 100], backendMs: 20, failure: 'retry-after' },
  { name: 'serverless, failing backend', kind: 'open', mode: 'serverless', drain: true, rate: 1000, durationMs: 10_000, handlerMs: [20, 100], backendMs: 20, failure: 'retryable' },
]

const FLUSH_TIMEOUT_MS = 15_000

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!
}

async function importExport(pkgDir: string, subpath: string): Promise<Record<string, any>> {
  const pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'))
  const target = pkg.exports[subpath]
  return import(pathToFileURL(join(pkgDir, typeof target === 'string' ? target : target.import)).href)
}

async function runChild(scenario: Scenario, pkgDir: string, pkgName: string): Promise<Result> {
  if (scenario.mode === 'serverless') process.env.VERCEL = '1'
  const version = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8')).version as string
  const { initLogger } = await importExport(pkgDir, '.')
  const { createDrainPipeline } = await importExport(pkgDir, './pipeline')
  const { createMiddlewareLogger } = await importExport(pkgDir, './toolkit')

  let delivered = 0
  let sends = 0
  const dropped: Record<string, number> = {}
  const send = async (batch: unknown[]): Promise<void> => {
    sends++
    if (scenario.backendMs) await sleep(scenario.backendMs)
    switch (scenario.failure) {
      case 'retryable': throw Object.assign(new Error('503 Service Unavailable'), { retryable: true })
      case 'rejected': throw Object.assign(new Error('400 Bad Request'), { retryable: false })
      case 'retry-after': throw Object.assign(new Error('429 Too Many Requests'), { retryable: true, retryAfterMs: 60_000 })
      default: delivered += batch.length
    }
  }
  const drain = scenario.drain
    ? createDrainPipeline({
      onDropped: (events: unknown[], error: Error | undefined, reason?: string) => {
        const key = reason ?? (error ? 'retries-exhausted' : 'buffer-full')
        dropped[key] = (dropped[key] ?? 0) + events.length
      },
    })(send)
    : undefined

  initLogger({ env: { service: 'load', environment: 'production' }, pretty: false, silent: true, _suppressDrainWarning: true })

  const waitUntilLatencies: number[] = []
  let waitUntilOpen = 0
  const waitUntil = scenario.mode === 'node' ? undefined : (promise: Promise<unknown>) => {
    const t0 = performance.now()
    waitUntilOpen++
    void promise.finally(() => {
      waitUntilOpen--
      waitUntilLatencies.push(performance.now() - t0)
    })
  }
  const headers = { 'user-agent': 'load', 'content-type': 'application/json' }

  const overheads: number[] = []
  async function request(i: number, handlerMs: number): Promise<void> {
    const t0 = performance.now()
    const { logger, finish } = createMiddlewareLogger({ method: 'POST', path: '/api/checkout', requestId: `req_${i}`, headers, drain, waitUntil })
    logger.set({ user: { id: `usr_${i}`, plan: 'pro' }, cart: { items: 3, total: 9999, currency: 'USD' } })
    if (handlerMs > 0) await sleep(handlerMs)
    logger.set({ payment: { method: 'card', gateway: 'stripe' } })
    await finish({ status: 200 })
    if (handlerMs > 0) overheads.push(performance.now() - t0 - handlerMs)
  }

  const eld = monitorEventLoopDelay({ resolution: 10 })
  let heapPeak = 0
  let rssPeak = 0
  const sample = (): void => {
    const m = process.memoryUsage()
    heapPeak = Math.max(heapPeak, m.heapUsed)
    rssPeak = Math.max(rssPeak, m.rss)
  }
  const sampler = setInterval(sample, 50)

  globalThis.gc?.()
  eld.enable()
  const cpu0 = process.cpuUsage()
  const wall0 = performance.now()
  let nsPerRequest: number | undefined
  let achievedRps: number | undefined

  if (scenario.kind === 'hot') {
    const n = scenario.requests!
    for (let i = 0; i < 5000; i++) await request(i, 0)
    const t0 = performance.now()
    for (let i = 0; i < n; i++) await request(i, 0)
    nsPerRequest = (performance.now() - t0) * 1e6 / n
  } else {
    const { rate, durationMs, handlerMs: [min, max] = [0, 0] } = scenario as Required<Scenario>
    let launched = 0
    const inflight: Array<Promise<void>> = []
    await new Promise<void>((done) => {
      const tick = setInterval(() => {
        const elapsed = performance.now() - wall0
        const due = Math.min(Math.floor(elapsed / 1000 * rate), Math.floor(durationMs / 1000 * rate))
        while (launched < due) inflight.push(request(launched++, min + Math.random() * (max - min)))
        if (elapsed >= durationMs) {
          clearInterval(tick)
          done()
        }
      }, 1)
    })
    await Promise.all(inflight)
    achievedRps = inflight.length / ((performance.now() - wall0) / 1000)
  }

  const backlogAtEnd = drain?.pending ?? 0
  const waitUntilOpenAtEnd = waitUntilOpen
  const flush0 = performance.now()
  if (drain) await Promise.race([drain.flush(), sleep(FLUSH_TIMEOUT_MS)])
  const flushMs = performance.now() - flush0
  const wall = performance.now() - wall0
  const cpu = process.cpuUsage(cpu0)
  eld.disable()
  sample()
  clearInterval(sampler)
  globalThis.gc?.()
  const heapAfterGc = process.memoryUsage().heapUsed

  const sortedOverheads = overheads.sort((a, b) => a - b)
  const sortedWait = waitUntilLatencies.sort((a, b) => a - b)
  return {
    scenario: scenario.name,
    pkg: pkgName,
    version,
    nsPerRequest,
    achievedRps,
    cpuPct: (cpu.user + cpu.system) / 1000 / wall * 100,
    eldP99Ms: eld.percentile(99) / 1e6,
    eldMaxMs: eld.max / 1e6,
    heapPeakMB: heapPeak / 2 ** 20,
    heapAfterGcMB: heapAfterGc / 2 ** 20,
    rssPeakMB: rssPeak / 2 ** 20,
    ...(sortedOverheads.length > 0 && { overheadP50Ms: percentile(sortedOverheads, 0.5), overheadP99Ms: percentile(sortedOverheads, 0.99) }),
    ...(waitUntil && {
      waitUntilP50Ms: percentile(sortedWait, 0.5),
      waitUntilP99Ms: percentile(sortedWait, 0.99),
      waitUntilOpenAtEnd,
    }),
    delivered,
    sends,
    dropped,
    backlogAtEnd,
    flushMs,
  }
}

function spawnChild(scenario: Scenario, pkgDir: string, pkgName: string): Promise<Result> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--import', 'tsx', fileURLToPath(import.meta.url), '--child', JSON.stringify({ scenario, pkgDir, pkgName })], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, VERCEL: '', NODE_ENV: 'production' },
    })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`${scenario.name} on ${pkgName} exited with ${code}`))
      resolvePromise(JSON.parse(out.trim().split('\n').at(-1)!))
    })
  })
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function fmt(n: number | undefined, digits = 1): string {
  return n === undefined ? '-' : n.toFixed(digits)
}

function printTable(results: Result[]): void {
  const keys: Array<[keyof Result, string, number]> = [
    ['nsPerRequest', 'ns/req', 0],
    ['achievedRps', 'req/s', 0],
    ['cpuPct', 'CPU %', 0],
    ['eldP99Ms', 'ELD p99 ms', 1],
    ['heapPeakMB', 'heap peak MB', 1],
    ['heapAfterGcMB', 'heap after GC MB', 1],
    ['overheadP99Ms', 'req overhead p99 ms', 2],
    ['waitUntilP50Ms', 'waitUntil p50 ms', 0],
    ['waitUntilP99Ms', 'waitUntil p99 ms', 0],
    ['waitUntilOpenAtEnd', 'waitUntil open at end', 0],
    ['delivered', 'delivered', 0],
    ['backlogAtEnd', 'backlog at end', 0],
    ['flushMs', 'final flush ms', 0],
  ]
  const byScenario = new Map<string, Result[]>()
  for (const r of results) byScenario.set(r.scenario, [...(byScenario.get(r.scenario) ?? []), r])
  for (const [scenario, rows] of byScenario) {
    const pkgs = [...new Set(rows.map(r => r.pkg))]
    console.log(`\n### ${scenario}\n`)
    console.log(`| | ${pkgs.join(' | ')} |`)
    console.log(`|---|${pkgs.map(() => '---:').join('|')}|`)
    for (const [key, label, digits] of keys) {
      const values = pkgs.map((pkg) => {
        const own = rows.filter(r => r.pkg === pkg).map(r => r[key]).filter((v): v is number => typeof v === 'number')
        return own.length === 0 ? undefined : median(own)
      })
      if (values.every(v => v === undefined)) continue
      console.log(`| ${label} | ${values.map(v => fmt(v, digits)).join(' | ')} |`)
    }
    const drops = pkgs.map((pkg) => {
      const last = rows.filter(r => r.pkg === pkg).at(-1)!
      const entries = Object.entries(last.dropped).filter(([, n]) => n > 0)
      return entries.length === 0 ? '0' : entries.map(([k, n]) => `${n} ${k}`).join(', ')
    })
    console.log(`| dropped | ${drops.join(' | ')} |`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const childIndex = args.indexOf('--child')
  if (childIndex !== -1) {
    const { scenario, pkgDir, pkgName } = JSON.parse(args[childIndex + 1]!)
    const result = await runChild(scenario, pkgDir, pkgName)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exit(0)
  }

  const pkgs: Array<[string, string]> = []
  let only: string | undefined
  let repeat = 1
  let jsonPath: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pkg') {
      const [name, dir] = args[++i]!.split('=') as [string, string]
      pkgs.push([name, resolve(dir)])
    } else if (args[i] === '--only') only = args[++i]
    else if (args[i] === '--repeat') repeat = Number(args[++i])
    else if (args[i] === '--json') jsonPath = args[++i]
  }
  if (pkgs.length === 0) pkgs.push(['head', fileURLToPath(new URL('../../', import.meta.url))])

  const scenarios = SCENARIOS.filter(s => !only || s.name.includes(only))
  const results: Result[] = []
  for (const scenario of scenarios) {
    // Interleaved so drift on the machine spreads across every package.
    for (let round = 0; round < repeat; round++) {
      for (const [name, dir] of pkgs) {
        const result = await spawnChild(scenario, dir, name)
        results.push(result)
        console.error(`${scenario.name} | ${name} | round ${round + 1} done`)
      }
    }
  }
  printTable(results)
  if (jsonPath) await writeFile(jsonPath, JSON.stringify(results, null, 2))
}

await main()
