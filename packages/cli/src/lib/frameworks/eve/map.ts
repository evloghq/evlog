import { basename, dirname, join, relative } from 'node:path'
import { glob } from '../../glob'
import { findHandlerLocation, parseFile } from '../../map/parse'
import type { ExtractedRoute, RouteKind, ScanContext } from '../../map/types'
import { relativeFromRoot } from '../../map/utils'
import type { MapAdapter } from '../types'
import { eveAgentDirs, findEveMount } from './mount'

const MODULE_EXT = '{ts,js,mts,cts,mjs,cjs}'

/** Where an agent declares each kind of entry point. Schedules and channels are root-only. */
const SLOTS: ReadonlyArray<{ kind: RouteKind, dir: string, patterns: readonly string[], rootOnly: boolean }> = [
  { kind: 'tool', dir: 'tools', patterns: [`tools/**/*.${MODULE_EXT}`], rootOnly: false },
  { kind: 'schedule', dir: 'schedules', patterns: [`schedules/**/*.${MODULE_EXT}`, 'schedules/**/*.md'], rootOnly: true },
  { kind: 'channel', dir: 'channels', patterns: [`channels/**/*.${MODULE_EXT}`], rootOnly: true },
]

/** eve leaves colocated tests out of discovery. */
function isTest(path: string): boolean {
  return /\.(?:test|spec)\.[^/]+$/.test(path) || path.split('/').includes('__tests__')
}

/**
 * Every agent the project builds, `agent/` or each workspace member's
 * `agents/<name>/agent/`, and the declared subagents under each, with the name
 * prefix of its tools. A member's entry points carry its name: `support/lookup`.
 */
function agentDirs(root: string): Array<{ dir: string, prefix: string, isRoot: boolean }> {
  const found = eveAgentDirs(root).map(dir => ({
    dir: join(root, dir),
    prefix: dir === 'agent' ? '' : `${basename(dirname(dir))}/`,
    isRoot: true,
  }))
  /* `for…of` also visits the entries pushed while it runs: nested subagents. */
  for (const { dir, prefix } of found) {
    for (const config of glob(`subagents/*/agent.${MODULE_EXT}`, dir)) {
      const sub = dirname(config)
      found.push({ dir: sub, prefix: `${prefix}${relative(join(dir, 'subagents'), sub)}/`, isRoot: false })
    }
  }
  return found
}

/**
 * An eve project's agents: their tools, schedules and channels, and the
 * tools of each declared subagent. Names come from paths, as eve derives them.
 * An agent that mounts `@evlog/eve` records every one of them on its turn events.
 */
const eveAdapter: MapAdapter = {
  // eslint-disable-next-line require-await -- satisfies the async MapAdapter contract
  async extractRoutes(ctx: ScanContext): Promise<ExtractedRoute[]> {
    const parse = ctx.parse ?? parseFile
    const routes: ExtractedRoute[] = []

    for (const agent of agentDirs(ctx.projectRoot)) {
      const recorded = findEveMount(ctx.projectRoot, relative(ctx.projectRoot, agent.dir)) !== null
      for (const slot of SLOTS) {
        if (slot.rootOnly && !agent.isRoot) continue
        for (const file of glob(slot.patterns, agent.dir)) {
          const name = relative(join(agent.dir, slot.dir), file)
          if (isTest(name)) continue
          const parsed = parse(file)
          routes.push({
            framework: 'eve',
            kind: slot.kind,
            method: null,
            path: `${agent.prefix}${name.replace(/\.[^./]+$/, '')}`,
            file: relativeFromRoot(ctx.projectRoot, file),
            handler: parsed ? findHandlerLocation(parsed, ['defineTool', 'defineWorkflowTool', 'defineSchedule']) : null,
            recorded,
          })
        }
      }
    }
    return routes
  },
}

export default eveAdapter
