import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { EVLOG_FILE_CONFIG_KEY } from './fileConfig'

/** Names `evlog.config` is looked up under, in order, in each directory. Same list as the CLI. */
const CONFIG_FILES = ['evlog.config.ts', 'evlog.config.mts', 'evlog.config.js', 'evlog.config.mjs']

/** Virtual module id of the server plugin that loads `evlog.config.ts`. */
export const EVLOG_CONFIG_PLUGIN_ID = '#evlog/config'

function isWorkspaceRoot(dir: string): boolean {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return false
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return true
  return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown }).workspaces !== undefined
}

function findWorkspaceRoot(start: string): string | undefined {
  let dir = start
  for (;;) {
    if (isWorkspaceRoot(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * The `evlog.config` that applies to the app in `rootDir`: the nearest one
 * from `rootDir` up to the workspace root, which is the file the CLI reads.
 * Outside a workspace only `rootDir` is searched.
 */
export function findEvlogConfigFile(rootDir: string): string | undefined {
  const root = findWorkspaceRoot(rootDir) ?? rootDir
  let dir = rootDir
  for (;;) {
    for (const name of CONFIG_FILES) {
      const file = join(dir, name)
      if (existsSync(file)) return file
    }
    const parent = dirname(dir)
    if (dir === root || parent === dir) return undefined
    dir = parent
  }
}

/** Source of the server plugin that imports `file` and hands its default export to the evlog Nitro plugin. */
export function evlogConfigPluginSource(file: string): string {
  // Raw-interpolated into a JS string literal: POSIX separators keep Windows backslashes from reading as escapes.
  return [
    `import config from ${JSON.stringify(file.replace(/\\/g, '/'))}`,
    `globalThis[Symbol.for(${JSON.stringify(EVLOG_FILE_CONFIG_KEY)})] = config`,
    'export default function evlogConfig() {}',
    '',
  ].join('\n')
}

/** The slice of Nitro options the config plugin is registered on, shared by nitropack v2 and Nitro v3. */
interface NitroOptionsTarget {
  options: {
    rootDir: string
    plugins: string[]
    virtual: Record<string, unknown>
  }
}

/**
 * Load `evlog.config.ts` into the server bundle when the app has one, through
 * a virtual plugin placed first so the file is evaluated before any plugin
 * runs. Call it once options are resolved (from a Nitro module's `setup` or
 * Nuxt's `nitro:init`): a plugin id added earlier is resolved as a path.
 * Returns the file it registered.
 */
export function registerEvlogConfigPlugin(nitro: NitroOptionsTarget): string | undefined {
  const file = findEvlogConfigFile(nitro.options.rootDir)
  if (!file) return undefined
  nitro.options.virtual[EVLOG_CONFIG_PLUGIN_ID] = evlogConfigPluginSource(file)
  nitro.options.plugins.unshift(EVLOG_CONFIG_PLUGIN_ID)
  return file
}
