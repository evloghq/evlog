import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WiringInput, WiringPlan } from '../../init/wiring'
import { evlogConfigImport } from '../../init/wiring'
import { EVE_INSTRUMENTATION, inspectEveInstrumentation } from '../../setup-eve'
import { findEveMount } from './mount'

const EXTENSION = join('agent', 'extensions', 'evlog.ts')

/** Mounts `@evlog/eve` from the config, and adds the trace ids `evlog setup eve` writes. */
export default function planEve(input: WiringInput): WiringPlan {
  const plan: WiringPlan = { actions: [], manual: [], already: [] }

  const mount = findEveMount(input.root)
  if (mount) {
    plan.already.push(`${mount} already mounts @evlog/eve`)
  } else if (existsSync(join(input.root, EXTENSION))) {
    plan.manual.push({
      title: 'Mount @evlog/eve',
      file: EXTENSION,
      snippet: `import evlog from '@evlog/eve'\nimport config from '${evlogConfigImport(input, EXTENSION)}'\n\nexport default evlog(config)`,
      reason: `${EXTENSION} exists and does not import @evlog/eve, and init does not rewrite a file you wrote`,
    })
  } else {
    plan.actions.push({
      path: join(input.root, EXTENSION),
      relative: EXTENSION,
      kind: 'create',
      contents: `import evlog from '@evlog/eve'
import config from '${evlogConfigImport(input, EXTENSION)}'

/** One wide event per agent turn, with the settings in evlog.config.ts. */
export default evlog(config)
`,
    })
  }

  const traces = inspectEveInstrumentation(input.root)
  if (traces.state === 'present') {
    plan.already.push(`${traces.file} already exports evlogTraces()`)
  } else if (traces.state === 'conflict') {
    plan.manual.push({
      title: 'Put trace ids on each turn\'s event',
      file: traces.file,
      snippet: EVE_INSTRUMENTATION.trim(),
      reason: `${traces.file} exists without evlogTraces(), and init does not rewrite a file you wrote`,
    })
  } else {
    plan.actions.push({ path: join(input.root, traces.file), relative: traces.file, kind: 'create', contents: EVE_INSTRUMENTATION })
  }

  const engines = readEngines(input.root)
  if (engines && requiresNode24(engines)) {
    plan.already.push(`package.json already requires Node ${engines}`)
  } else {
    plan.manual.push({
      title: 'Run the agent on Node 24 or later',
      file: 'package.json',
      snippet: `"engines": { "node": ">=24" }`,
      reason: `eve 1.0 and @evlog/eve require Node 24${engines ? `, and engines.node allows ${engines}` : ''}`,
    })
  }

  return plan
}

function readEngines(root: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines?: { node?: unknown } }
    return typeof pkg.engines?.node === 'string' ? pkg.engines.node : null
  } catch {
    return null
  }
}

/** Every lower bound in the range is 24 or above: `>=24`, `^24.1.0`, `24.x`, `>=24 <26`. */
function requiresNode24(range: string): boolean {
  return range.split('||').every((part) => {
    const major = /\d+/.exec(part.replace(/<=?\s*\d+(\.\d+)*/g, ''))
    return major !== null && Number(major[0]) >= 24
  })
}
