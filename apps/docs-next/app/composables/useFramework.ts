/**
 * The framework the reader picked, in the sidebar or in any `::framework-tabs` group. A cookie so
 * the inline head script in `plugins/framework-choice.ts` can read it before first paint; the
 * prerendered HTML itself never depends on it.
 */
export function useFramework() {
  return useCookie<string | undefined>('evlog-framework', {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
}

/** The choice as the page sees it after mount, shared by the sidebar picker and every tab group. */
export function useFrameworkChoice() {
  const cookie = useFramework()
  const choice = useState<string | undefined>('framework-choice', () => undefined)

  onMounted(() => {
    choice.value ??= document.documentElement.dataset.framework
  })

  function choose(id: string) {
    cookie.value = id
    choice.value = id
    document.documentElement.dataset.framework = id
  }

  return { choice, choose }
}

/** The integration page of each framework, by framework id. */
export const frameworkPages: Record<string, string> = {
  'nuxt': '/integrations/nuxt',
  'nitro': '/integrations/nitro',
  'next': '/integrations/next',
  'sveltekit': '/integrations/sveltekit',
  'tanstack-start': '/integrations/tanstack-start',
  'react-router': '/integrations/react-router',
  'hono': '/integrations/hono',
  'express': '/integrations/express',
  'fastify': '/integrations/fastify',
  'elysia': '/integrations/elysia',
  'nestjs': '/integrations/nestjs',
  'orpc': '/integrations/orpc',
  'effect': '/integrations/effect',
  'workers': '/integrations/cloudflare-workers',
  'astro': '/integrations/astro',
  'lambda': '/integrations/aws-lambda',
  'standalone': '/integrations/standalone',
}
