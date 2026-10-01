import type { Framework, FrameworkAdapter } from '../types'
import { honoAdapter } from './hono'
import { nextAdapter } from './next'
import { nitroAdapter, nuxtAdapter } from './nuxt'
import { tanstackStartAdapter } from './tanstack-start'

const ADAPTERS: Record<Framework, FrameworkAdapter> = {
  'nuxt': nuxtAdapter,
  'nitro': nitroAdapter,
  'next': nextAdapter,
  'tanstack-start': tanstackStartAdapter,
  'hono': honoAdapter,
}

/** Resolve the route-extraction adapter for a detected framework. */
export function getAdapter(framework: Framework): FrameworkAdapter {
  return ADAPTERS[framework]
}
