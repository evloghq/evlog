import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { readConfig } from '../../config/read'
import type { WiringInput, WiringPlan } from '../../init/wiring'
import { configCandidates, evlogConfigImport, firstExisting } from '../../init/wiring'
import { EVE_INSTRUMENTATION, inspectEveInstrumentation } from '../../setup-eve'
import { eveAgentDirs, findEveMount } from './mount'

/** The mount init writes. Named `evlog`, so the logs tool is `evlog__logs`. */
function mountTemplate(input: WiringInput, file: string): string {
  const head = `import evlog from '@evlog/eve'\nimport config from '${evlogConfigImport(input, file)}'\n`
  if (input.agentLogs) {
    return `${head}\n/** One wide event per agent turn, with the settings in evlog.config.ts. */\nexport default evlog(config)\n`
  }
  return `${head}
/** One wide event per agent turn, with the settings in evlog.config.ts. */
export default evlog({
  ...config,
  // Hides the evlog__logs tool. Remove to let the agent read its own events.
  logs: { ...config.logs, access: () => false },
})
`
}

/**
 * Mounts `@evlog/eve` in each agent (`agent/`, or every `agents/<name>/agent/`)
 * from `evlog.config.ts`, and adds the trace ids `evlog setup eve` writes.
 * Creates missing files only; anything already there is reported or handed
 * back as the lines to add.
 */
export default function planEve(input: WiringInput): WiringPlan {
  const plan: WiringPlan = { actions: [], manual: [], already: [], notes: [] }
  const agents = eveAgentDirs(input.root)

  for (const agentDir of agents.length > 0 ? agents : ['agent']) {
    const file = join(agentDir, 'extensions', 'evlog.ts')
    const mount = findEveMount(input.root, agentDir)
    if (mount) {
      plan.already.push(`${mount.file} already mounts @evlog/eve${mount.name === 'evlog' ? '' : `, so its logs tool is ${mount.name}__logs`}`)
    } else if (existsSync(join(input.root, file)) || existsSync(join(input.root, agentDir, 'extensions', 'evlog'))) {
      plan.manual.push({
        title: 'Mount @evlog/eve',
        file,
        snippet: mountTemplate(input, file).trim(),
        reason: `an evlog mount is already there and does not import @evlog/eve, and init does not rewrite a file you wrote`,
      })
    } else {
      plan.actions.push({ path: join(input.root, file), relative: file, kind: 'create', contents: mountTemplate(input, file) })
    }

    const traces = inspectEveInstrumentation(input.root, agentDir)
    if (traces.state === 'present') {
      plan.already.push(`${traces.file} already exports evlogTraces()`)
    } else if (traces.state === 'conflict') {
      plan.manual.push({
        title: 'Put trace ids on each turn\'s event',
        file: join(agentDir, 'instrumentation', 'evlog-traces.ts'),
        snippet: EVE_INSTRUMENTATION.trim(),
        reason: `${traces.file} exists without evlogTraces(), and init does not rewrite a file you wrote`,
      })
    } else {
      plan.actions.push({ path: join(input.root, traces.file), relative: traces.file, kind: 'create', contents: EVE_INSTRUMENTATION })
    }
  }

  const node = declaredNode(input.root)
  if (node && requiresNode24(node.range)) {
    plan.already.push(`${node.source} already requires Node ${node.range}`)
  } else {
    plan.manual.push({
      title: 'Run the agent on Node 24 or later',
      file: 'package.json',
      snippet: `"engines": { "node": ">=24" }`,
      reason: `eve 1.0 and @evlog/eve require Node 24${node ? `, and ${node.source} allows ${node.range}` : ''}`,
    })
  }

  const config = configLogs(input.root)
  if (input.agentLogs) {
    plan.notes.push(input.devDrain === 'none'
      ? 'The agent reads its own events with evlog__logs, but --drain none writes no local files, so in development it finds nothing'
      : 'The agent reads its own events with evlog__logs: a signed-in caller its own session, a schedule every turn. Locally it reads .evlog/logs')
    if (config.source === 'files') {
      plan.notes.push('evlog.config.ts sets logs.source to files, which keeps the deployed agent reading local files instead of its Vercel runtime logs')
    }
  }
  if (input.logsConnector && config.file && config.connector !== input.logsConnector) {
    plan.manual.push({
      title: `Read the agent's Vercel logs through ${input.logsConnector}`,
      file: config.file,
      snippet: `logs: { vercel: { connector: '${input.logsConnector}' } },`,
      reason: config.connector
        ? `${config.file} names ${config.connector}, and init does not rewrite a config you wrote`
        : `init does not rewrite a config you wrote`,
    })
  } else if (input.vercelProject && !input.logsConnector) {
    plan.notes.push(config.connector
      ? `Vercel project ${input.vercelProject} is linked, and evlog.config.ts names ${config.connector}. npx evlog setup vercel --check shows whether the deployed agent can read through it`
      : `Vercel project ${input.vercelProject} is linked. The deployed agent reads its runtime logs once a connector is chosen: npx evlog setup vercel lists the team's connectors and asks which to use`)
  }

  if (input.host === 'nuxt') {
    const nuxtConfig = firstExisting(input.root, configCandidates('nuxt.config'))
    if (nuxtConfig && /\bevlog\s*:\s*\{/.test(readFileSync(nuxtConfig, 'utf8'))) {
      plan.notes.push(`The evlog block in ${relative(input.root, nuxtConfig)} reaches the Nuxt server only. The agent reads evlog.config.ts, so settings both should share belong there`)
    }
  }

  return plan
}

/** `engines.node` from `package.json`, else `.nvmrc` or `.node-version`. */
function declaredNode(root: string): { range: string, source: string } | null {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines?: { node?: unknown } }
  if (typeof pkg.engines?.node === 'string') return { range: pkg.engines.node, source: 'engines.node' }
  for (const file of ['.nvmrc', '.node-version']) {
    if (existsSync(join(root, file))) return { range: readFileSync(join(root, file), 'utf8').trim().replace(/^v/, ''), source: file }
  }
  return null
}

/** Every lower bound in the range is 24 or above: `>=24`, `^24.1.0`, `24.x`, `>=24 <26`. */
function requiresNode24(range: string): boolean {
  return range.split('||').every((part) => {
    const major = /\d+/.exec(part.replace(/<=?\s*\d+(\.\d+)*/g, ''))
    return major !== null && Number(major[0]) >= 24
  })
}

/** What an existing `evlog.config` says about logs, when it can be read without running it. */
function configLogs(root: string): { file?: string, source?: unknown, connector?: string } {
  const path = firstExisting(root, configCandidates('evlog.config'))
  if (!path) return {}
  const file = relative(root, path)
  try {
    const value = readConfig(path, label => label).config.value as { logs?: { source?: unknown, vercel?: { connector?: unknown } } }
    const connector = value.logs?.vercel?.connector
    return { file, source: value.logs?.source, ...(typeof connector === 'string' && { connector }) }
  } catch {
    return { file }
  }
}
