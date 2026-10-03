import { describe, expect, it } from 'vitest'
import { frameworks, resolveFramework } from '../app/utils/frameworks'

describe('resolveFramework', () => {
  it.each([
    ['Nuxt', 'nuxt'],
    ['Nuxt / Nitro', 'nuxt'],
    ['Nitro', 'nitro'],
    ['Next.js', 'next'],
    ['Hono / Express / Fastify / Elysia / NestJS', 'hono'],
    ['lib/evlog.ts (Next.js)', 'next'],
    ['index.ts (Hono / Express / Fastify)', 'hono'],
    ['nuxt.config.ts', 'nuxt'],
    ['Hono (Cloudflare Workers)', 'hono'],
    ['app/providers.tsx (React / Next.js)', 'next'],
    ['Next.js App Router', 'next'],
    ['Standalone job', 'standalone'],
    ['Cloudflare Workers', 'workers'],
  ])('%s -> %s', (label, id) => {
    expect(resolveFramework(label)?.id).toBe(id)
  })

  it.each(['Output', 'server/api/checkout.post.ts', 'nitro.config.ts (v3)', 'composables/useCheckout.ts (Nuxt UI)', 'pnpm'])(
    '%s names no framework',
    (label) => {
      expect(resolveFramework(label)).toBeUndefined()
    },
  )

  it('never maps one name to two frameworks', () => {
    const names = frameworks.flatMap(f => [...new Set([f.id, f.label, ...(f.aliases ?? [])].map(n => n.toLowerCase()))])
    expect(new Set(names).size).toBe(names.length)
  })
})
