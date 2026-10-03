import { express } from './express'
import { fastify } from './fastify'
import { hono } from './hono'
import { next } from './next'
import { nitro } from './nitro'
import { nuxt } from './nuxt'
import { tanstackStart } from './tanstack-start'
import type { FrameworkDefinition, InitPlanner } from './types'

export type { FrameworkDefinition, FrameworkDetection, FrameworkShape, InitPlanner, MapAdapter } from './types'
export { defineFramework } from './types'

/**
 * Every framework the CLI supports, in detection-tie order.
 *
 * Adding one is a new directory next to these: `index.ts` with the definition,
 * `map.ts` with route discovery, `init.ts` when `evlog init` can wire it. The
 * `Framework` type, `--framework` parsing and help text, detection, labels,
 * docs links, telemetry allowlists and error messages all derive from the list.
 */
const DEFINITIONS = [nuxt, nitro, next, tanstackStart, hono, express, fastify] as const

/** Frameworks the CLI supports. */
export type Framework = typeof DEFINITIONS[number]['id']

/** Frameworks `evlog init` can wire. */
export type InitFramework = Extract<typeof DEFINITIONS[number], { init: () => Promise<InitPlanner> }>['id']

/** Every supported framework, in detection-tie order. */
export const FRAMEWORKS: readonly FrameworkDefinition<Framework>[] = DEFINITIONS

/** Every supported framework id. */
export const FRAMEWORK_IDS: readonly Framework[] = DEFINITIONS.map(definition => definition.id)

/** Framework ids `evlog init` can wire. */
export const INIT_FRAMEWORK_IDS: readonly InitFramework[] = DEFINITIONS
  .filter((definition): definition is Extract<typeof definition, { init: () => Promise<InitPlanner> }> => 'init' in definition)
  .map(definition => definition.id)

/** Look up a framework definition by id. */
export function getFramework(id: Framework): FrameworkDefinition<Framework> {
  return FRAMEWORKS.find(definition => definition.id === id)!
}

/** Narrow a user-supplied string, e.g. `--framework`, to a supported framework. */
export function isFramework(value: string): value is Framework {
  return (FRAMEWORK_IDS as readonly string[]).includes(value)
}

/** Whether `evlog init` can wire this framework. */
export function isInitFramework(id: string): id is InitFramework {
  return (INIT_FRAMEWORK_IDS as readonly string[]).includes(id)
}
