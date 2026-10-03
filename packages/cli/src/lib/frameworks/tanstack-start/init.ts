import { relative } from 'node:path'
import type { WiringInput, WiringPlan } from '../../init/wiring'
import planNitro from '../nitro/init'
import { configCandidates, firstExisting } from '../../init/wiring'

/** The root route is a component file — splicing a middleware into it is guesswork. */
function withTanstackNotes(plan: WiringPlan, input: WiringInput): WiringPlan {
  if (input.extras.includes('vite')) {
    // The plugin order in vite.config.ts varies per template — cheaper to paste than to guess.
    const viteConfig = firstExisting(input.root, configCandidates('vite.config'))
    plan.manual.push({
      title: 'Add the evlog Vite plugin',
      file: viteConfig ? relative(input.root, viteConfig) : 'vite.config.ts',
      snippet: `import evlog from 'evlog/vite'

export default defineConfig({
  plugins: [
    evlog(),
    // …your existing plugins
  ],
})`,
      reason: 'strips log.debug() from production builds and injects source locations',
    })
  }

  const rootRoute = firstExisting(input.root, ['src/routes/__root.tsx', 'app/routes/__root.tsx'])
  plan.manual.push({
    title: 'Return structured errors from the root route',
    file: rootRoute ? relative(input.root, rootRoute) : 'src/routes/__root.tsx',
    snippet: `import { createMiddleware } from '@tanstack/react-start'
import { evlogErrorHandler } from 'evlog/nitro/v3'

export const Route = createRootRoute({
  server: {
    middleware: [createMiddleware().server(evlogErrorHandler)],
  },
})`,
    reason: 'TanStack Start handles errors before Nitro, so createError() needs this middleware to keep why / fix / link',
  })
  return plan
}

/** TanStack Start runs on Nitro v3: the Nitro plan, plus the notes only its templates need. */
export default function planTanstackStart(input: WiringInput): WiringPlan {
  return withTanstackNotes(planNitro(input), input)
}
