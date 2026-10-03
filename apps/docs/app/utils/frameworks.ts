export interface Framework {
  id: string
  label: string
  icon: string
  /** Brand colour applied to a monochrome icon. Omitted when the brand is black on white. */
  color?: string
  aliases?: string[]
}

export const frameworks: Framework[] = [
  { id: 'nuxt', label: 'Nuxt', icon: 'i-custom:nuxt', color: '#00DC82', aliases: ['nuxt / nitro', 'nuxt.config.ts'] },
  { id: 'nitro', label: 'Nitro', icon: 'i-custom:nitro' },
  { id: 'next', label: 'Next.js', icon: 'i-simple-icons-nextdotjs', aliases: ['nextjs', 'next.js app router', 'instrumentation.ts'] },
  { id: 'sveltekit', label: 'SvelteKit', icon: 'i-simple-icons-svelte', color: '#FF3E00', aliases: ['svelte'] },
  { id: 'tanstack-start', label: 'TanStack Start', icon: 'i-custom:tanstack', aliases: ['tanstack'] },
  { id: 'nestjs', label: 'NestJS', icon: 'i-simple-icons-nestjs', color: '#E0234E', aliases: ['nest'] },
  { id: 'express', label: 'Express', icon: 'i-simple-icons-express' },
  { id: 'hono', label: 'Hono', icon: 'i-simple-icons-hono', color: '#E36002' },
  { id: 'fastify', label: 'Fastify', icon: 'i-simple-icons-fastify' },
  { id: 'elysia', label: 'Elysia', icon: 'i-custom:elysia' },
  { id: 'react-router', label: 'React Router', icon: 'i-custom:reactrouter', color: '#F44250' },
  { id: 'workers', label: 'Cloudflare Workers', icon: 'i-simple-icons-cloudflareworkers', color: '#F38020', aliases: ['cloudflare', 'cloudflare workers'] },
  { id: 'astro', label: 'Astro', icon: 'i-simple-icons-astro', color: '#BC52EE' },
  { id: 'orpc', label: 'oRPC', icon: 'i-lucide-cable' },
  { id: 'lambda', label: 'AWS Lambda', icon: 'i-custom:lambda', color: '#FF9900', aliases: ['aws lambda', 'aws'] },
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
