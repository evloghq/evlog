export interface Framework {
  id: string
  label: string
  icon: string
  aliases?: string[]
}

export const frameworks: Framework[] = [
  { id: 'nuxt', label: 'Nuxt', icon: 'i-logos-nuxt-icon', aliases: ['nuxt / nitro', 'nuxt.config.ts'] },
  { id: 'nitro', label: 'Nitro', icon: 'i-custom:nitro-color' },
  { id: 'next', label: 'Next.js', icon: 'i-logos-nextjs-icon', aliases: ['nextjs', 'next.js app router', 'instrumentation.ts'] },
  { id: 'sveltekit', label: 'SvelteKit', icon: 'i-logos-svelte-icon', aliases: ['svelte'] },
  { id: 'tanstack-start', label: 'TanStack Start', icon: 'i-custom:tanstack-emblem', aliases: ['tanstack'] },
  { id: 'react-router', label: 'React Router', icon: 'i-logos-react-router' },
  { id: 'hono', label: 'Hono', icon: 'i-logos-hono' },
  { id: 'express', label: 'Express', icon: 'i-simple-icons-express' },
  { id: 'fastify', label: 'Fastify', icon: 'i-simple-icons-fastify' },
  { id: 'elysia', label: 'Elysia', icon: 'i-custom:elysia' },
  { id: 'nestjs', label: 'NestJS', icon: 'i-logos-nestjs', aliases: ['nest'] },
  { id: 'orpc', label: 'oRPC', icon: 'i-custom:orpc' },
  { id: 'workers', label: 'Cloudflare Workers', icon: 'i-logos-cloudflare-workers-icon', aliases: ['cloudflare', 'cloudflare workers'] },
  { id: 'astro', label: 'Astro', icon: 'i-logos-astro-icon' },
  { id: 'lambda', label: 'AWS Lambda', icon: 'i-logos-aws-lambda', aliases: ['aws lambda', 'aws'] },
  { id: 'standalone', label: 'Standalone', icon: 'i-lucide-box', aliases: ['standalone job'] },
]

const byName = new Map<string, Framework>()
for (const framework of frameworks) {
  for (const name of [framework.id, framework.label, ...(framework.aliases ?? [])]) {
    byName.set(name.toLowerCase(), framework)
  }
}

/**
 * Resolve a code fence label to a framework. Accepts the forms the docs use:
 * `Hono`, `Nuxt / Nitro`, `lib/evlog.ts (Next.js)`, `index.ts (Hono / Express)`.
 * The first segment that names a framework wins; a label naming none returns `undefined`.
 */
export function resolveFramework(label: string): Framework | undefined {
  const parenthetical = label.match(/\(([^)]*)\)\s*$/)?.[1] ?? ''
  const head = label.replace(/\s*\([^)]*\)\s*$/, '')
  const candidates = [head, parenthetical, ...head.split('/'), ...parenthetical.split('/')]
  for (const candidate of candidates) {
    const framework = byName.get(candidate.trim().toLowerCase())
    if (framework) return framework
  }
}
