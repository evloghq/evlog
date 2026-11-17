import { resolve } from 'node:path'
import { loadConfigFromFile } from 'vite'
import type { ConfigEnv, Plugin, UserConfig } from 'vite'
import { layerEvlogConfig } from '../shared/configMerge'
import { findEvlogConfigFile } from '../shared/configPlugin'
import type { EvlogConfig } from '../shared/define'
import type { EvlogViteOptions } from './types'

export function createAutoInitPlugin(options: EvlogViteOptions): Plugin {
  return {
    name: 'evlog:auto-init',
    config(userConfig, env) {
      const root = resolve(userConfig.root ?? process.cwd())
      const file = findEvlogConfigFile(root)
      if (!file) return defineConfig(options)

      return loadEvlogConfigFile(file, root, env).then(fileConfig =>
        defineConfig(layerEvlogConfig(fileSettings(fileConfig), options)),
      )
    },
  }
}

function defineConfig(options: EvlogViteOptions): UserConfig {
  return {
    define: {
      __EVLOG_CONFIG__: JSON.stringify(buildConfig(options)),
    },
  }
}

function buildConfig(options: EvlogViteOptions): Record<string, unknown> {
  const env: Record<string, unknown> = {}
  if (options.service) env.service = options.service
  if (options.environment) env.environment = options.environment

  const config: Record<string, unknown> = {}
  if (Object.keys(env).length > 0) config.env = env
  if (options.enabled !== undefined) config.enabled = options.enabled
  if (options.pretty !== undefined) config.pretty = options.pretty
  if (options.silent !== undefined) config.silent = options.silent
  if (options.sampling) config.sampling = options.sampling
  if (options.minLevel !== undefined) config.minLevel = options.minLevel
  if (options.stringify !== undefined) config.stringify = options.stringify

  return config
}

/** Load `evlog.config.ts` with Vite's own loader, so the file is bundled the way `vite.config.ts` is. */
async function loadEvlogConfigFile(file: string, root: string, env: ConfigEnv): Promise<EvlogConfig> {
  try {
    const loaded = await loadConfigFromFile(env, file, root)
    return loaded?.config as EvlogConfig
  } catch (error) {
    throw new Error(`evlog: failed to load ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

/** The settings of `evlog.config.ts` that `__EVLOG_CONFIG__` carries. Functions and the other keys stay out. */
function fileSettings(file: EvlogConfig): EvlogViteOptions {
  return {
    service: file.service ?? file.env?.service,
    environment: file.environment ?? file.env?.environment,
    enabled: file.enabled,
    pretty: file.pretty,
    silent: file.silent,
    sampling: file.sampling,
    minLevel: file.minLevel,
    stringify: file.stringify,
  }
}
