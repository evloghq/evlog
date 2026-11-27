// Runs every scenario against the evlog in this workspace and writes what it printed and emitted to
// app/data/events/<name>.json. The docs render those files, so no event on a page is typed by hand.
//
//   pnpm --filter evlog-docs-next capture

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { captureScenario, serialize } from './capture.ts'
import { scenarios } from './scenarios/index.ts'

const outDir = resolve(import.meta.dirname, '../app/data/events')
mkdirSync(outDir, { recursive: true })

for (const name of Object.keys(scenarios)) {
  const captured = captureScenario(name)
  writeFileSync(resolve(outDir, `${name}.json`), serialize(captured))
  console.log(`${name}: ${captured.steps.length} steps via ${captured.via}`)
}
