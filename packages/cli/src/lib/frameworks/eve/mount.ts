import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { glob } from '../../glob'

const MOUNT = /\bfrom\s+['"]@evlog\/eve['"]/
const MODULE = /\.[cm]?[jt]s$/

/**
 * The agents an eve project builds, relative to the package: `agent`, or each
 * `agents/<name>/agent` of a workspace. eve treats a project with a root
 * `agent/` as single-agent, and skips a member with its own `package.json`.
 */
export function eveAgentDirs(packageDir: string): string[] {
  if (existsSync(join(packageDir, 'agent'))) return ['agent']
  const members = join(packageDir, 'agents')
  if (!existsSync(members)) return []
  return readdirSync(members, { withFileTypes: true })
    .filter(entry => entry.isDirectory()
      && existsSync(join(members, entry.name, 'agent'))
      && !existsSync(join(members, entry.name, 'package.json')))
    .map(entry => join('agents', entry.name, 'agent'))
    .sort()
}

export interface EveMount {
  /** The mount file, relative to the package. */
  file: string
  /** The mount name, which prefixes the extension's tools: `evlog` gives `evlog__logs`. */
  name: string
}

/**
 * Where an agent mounts `@evlog/eve`: a file `extensions/<name>.ts`, or a
 * directory `extensions/<name>/extension.ts`. Imports of its subpaths
 * (`@evlog/eve/logger`) do not count.
 */
export function findEveMount(packageDir: string, agentDir = 'agent'): EveMount | null {
  const dir = join(agentDir, 'extensions')
  if (!existsSync(join(packageDir, dir))) return null
  for (const name of readdirSync(join(packageDir, dir)).sort()) {
    const path = join(packageDir, dir, name)
    if (statSync(path).isDirectory()) {
      const entry = readdirSync(path).find(file => /^extension\.[cm]?[jt]s$/.test(file))
      if (entry && MOUNT.test(readFileSync(join(path, entry), 'utf8'))) return { file: join(dir, name, entry), name }
    } else if (MODULE.test(name) && MOUNT.test(readFileSync(path, 'utf8'))) {
      return { file: join(dir, name), name: name.replace(MODULE, '') }
    }
  }
  return null
}

/**
 * Where a web app's eve integration runs the agent from, when its config sets
 * `eveRoot` (`withEve(config, { eveRoot })`, `eve: { eveRoot }`, `eveVite({ eveRoot })`).
 */
export function findEveRoot(packageDir: string): string | null {
  for (const file of glob(['{next,nuxt,vite,svelte,app}.config.{ts,mts,js,mjs}'], packageDir)) {
    const match = /\beveRoot\s*:\s*['"`]([^'"`]+)['"`]/.exec(readFileSync(file, 'utf8'))
    if (match) return match[1]!
  }
  return null
}
