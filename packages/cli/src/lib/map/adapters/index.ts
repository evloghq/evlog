import type { Framework, FrameworkAdapter } from '../types'
import { nextAdapter } from './next'
import { getNuxtOrNitroAdapter } from './nuxt'
import { tanstackStartAdapter } from './tanstack-start'
import { honoAdapter } from './hono'
import { expressAdapter } from './express'
import { fastifyAdapter } from './fastify'
import { elysiaAdapter } from './elysia'

/** Resolve the route-extraction adapter for a detected framework. */
export function getAdapter(framework: Framework): FrameworkAdapter {
  switch (framework) {
    case 'nuxt':
    case 'nitro':
      return getNuxtOrNitroAdapter(framework)
    case 'next':
      return nextAdapter
    case 'tanstack-start':
      return tanstackStartAdapter
    case 'hono':
      return honoAdapter
    case 'express':
      return expressAdapter
    case 'fastify':
      return fastifyAdapter
    case 'elysia':
      return elysiaAdapter
  }
}
