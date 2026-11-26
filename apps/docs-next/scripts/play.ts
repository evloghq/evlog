// Plays one step of a scenario in its own process. What evlog prints goes to stdout, and the event it
// handed to the drain goes to file descriptor 3, or `null` when it emitted none.

import { writeSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { initLogger, toLoggerConfig } from 'evlog'
import { drained } from './drain.ts'
import { scenarios } from './scenarios/index.ts'

const [name, id] = process.argv.slice(2)
const scenario = scenarios[name!]
const step = scenario?.steps.find(candidate => candidate.id === id)
if (!scenario || !step) throw new Error(`Unknown scenario step: ${name} ${id}`)

const dir = resolve(import.meta.dirname, 'scenarios')
const { draw } = step
if (draw !== undefined) Math.random = () => draw

// A route's entry file starts evlog from the config. A script does it in its own first lines.
if (!step.starts) {
  const { default: config } = await import(resolve(dir, step.config ?? scenario.config))
  initLogger(toLoggerConfig(config))
}

const code = await import(resolve(dir, step.file))

const request = step.request ?? scenario.request
if (request) {
  await code.app.request(request.path, {
    method: request.method,
    headers: { 'content-type': 'application/json', 'x-request-id': '4a8ff3a8-1c2e-4f6b-9d0a-7e5b3c1f2a90' },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  })
}
if (scenario.invoke) await code.handler(scenario.invoke)

// The drain is called after the response has left.
const expected = step.dropped ? 0 : 1
for (let waited = 0; drained.length < expected && waited < 2000; waited += 5) await sleep(5)
if (step.dropped) await sleep(50)
if (drained.length !== expected) throw new Error(`${name} ${id} drained ${drained.length} events, expected ${expected}`)

writeSync(3, JSON.stringify(drained[0] ?? null))
