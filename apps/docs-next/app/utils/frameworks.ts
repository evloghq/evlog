export type FrameworkKind = 'Full-stack' | 'Backend' | 'Runtime'

export interface Framework {
  id: string
  label: string
  icon: string
  kind: FrameworkKind
  /** The evlog entrypoint its integration imports. */
  entry: string
  aliases?: string[]
}

export const frameworks: Framework[] = [
  { id: 'nuxt', label: 'Nuxt', icon: 'i-logos-nuxt-icon', kind: 'Full-stack', entry: 'evlog/nuxt', aliases: ['nuxt / nitro', 'nuxt.config.ts'] },
  { id: 'nitro', label: 'Nitro', icon: 'i-custom:nitro-color', kind: 'Backend', entry: 'evlog/nitro' },
  { id: 'next', label: 'Next.js', icon: 'i-logos-nextjs-icon', kind: 'Full-stack', entry: 'evlog/next', aliases: ['nextjs', 'next.js app router', 'instrumentation.ts'] },
  { id: 'sveltekit', label: 'SvelteKit', icon: 'i-logos-svelte-icon', kind: 'Full-stack', entry: 'evlog/sveltekit', aliases: ['svelte'] },
  { id: 'tanstack-start', label: 'TanStack Start', icon: 'i-custom:tanstack-emblem', kind: 'Full-stack', entry: 'evlog/nitro', aliases: ['tanstack'] },
  { id: 'react-router', label: 'React Router', icon: 'i-custom:reactrouter', kind: 'Full-stack', entry: 'evlog/react-router' },
  { id: 'hono', label: 'Hono', icon: 'i-logos-hono', kind: 'Backend', entry: 'evlog/hono' },
  { id: 'express', label: 'Express', icon: 'i-simple-icons-express', kind: 'Backend', entry: 'evlog/express' },
  { id: 'fastify', label: 'Fastify', icon: 'i-simple-icons-fastify', kind: 'Backend', entry: 'evlog/fastify' },
  { id: 'elysia', label: 'Elysia', icon: 'i-custom:elysia', kind: 'Backend', entry: 'evlog/elysia' },
  { id: 'nestjs', label: 'NestJS', icon: 'i-logos-nestjs', kind: 'Backend', entry: 'evlog/nestjs', aliases: ['nest'] },
  { id: 'orpc', label: 'oRPC', icon: 'i-custom:orpc', kind: 'Backend', entry: 'evlog/orpc' },
  { id: 'effect', label: 'Effect', icon: 'i-simple-icons-effect', kind: 'Backend', entry: 'evlog/effect' },
  { id: 'workers', label: 'Cloudflare Workers', icon: 'i-logos-cloudflare-workers-icon', kind: 'Runtime', entry: 'evlog/workers', aliases: ['cloudflare', 'cloudflare workers'] },
  { id: 'astro', label: 'Astro', icon: 'i-simple-icons-astro', kind: 'Full-stack', entry: 'evlog' },
  { id: 'lambda', label: 'AWS Lambda', icon: 'i-logos-aws-lambda', kind: 'Runtime', entry: 'evlog', aliases: ['aws lambda', 'aws'] },
  { id: 'standalone', label: 'Standalone', icon: 'i-lucide-box', kind: 'Runtime', entry: 'evlog', aliases: ['standalone job'] },
]

const byName = new Map<string, Framework>()
for (const framework of frameworks) {
  for (const name of [framework.id, framework.label, ...(framework.aliases ?? [])]) {
    byName.set(name.toLowerCase(), framework)
  }
}

/**
 * Where a route lives in each framework's file layout. Code blocks labelled `[route:POST /api/checkout]`
 * show the reader's file in their header; the snippet itself is the same everywhere.
 */
export function routeFile(framework: string, method: string, route: string): string {
  const verb = method.toLowerCase()
  const path = route.replace(/^\/+/, '')
  const name = path.replace(/^api\//, '')
  const last = name.split('/').at(-1)!
  switch (framework) {
    case 'nuxt': return `server/${path}.${verb}.ts`
    case 'nitro': return `routes/${path}.${verb}.ts`
    case 'next': return `app/${path}/route.ts`
    case 'sveltekit': return `src/routes/${path}/+server.ts`
    case 'tanstack-start': return `src/routes/${path}.ts`
    case 'react-router': return `app/routes/${path.replaceAll('/', '.')}.ts`
    case 'astro': return `src/pages/${path}.ts`
    case 'nestjs': return `src/${name}.controller.ts`
    case 'orpc': return `server/procedures/${name}.ts`
    case 'workers': return 'src/worker.ts'
    case 'lambda': return `src/handlers/${last}.ts`
    default: return `src/routes/${name}.ts`
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
