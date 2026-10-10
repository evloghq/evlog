import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { WiringInput, WiringPlan } from '../../init/wiring'
import { addMiddlewareModule } from '../../init/wiring'

export default function planHono(input: WiringInput): WiringPlan {
  const plan: WiringPlan = { actions: [], manual: [], already: [] }
  const useSrc = existsSync(join(input.root, 'src'))
  const relativePath = useSrc ? join('src', 'evlog.ts') : 'evlog.ts'
  addMiddlewareModule(plan, input, relativePath, {
    source: 'evlog/hono',
    declare: options => `/** Register once, before your routes: \`app.use(evlogMiddleware)\`. */\nexport const evlogMiddleware = evlog(${options})`,
  })

  const entry = useSrc ? join('src', 'index.ts') : 'index.ts'
  plan.manual.push({
    title: 'Register the middleware on your app',
    file: entry,
    snippet: `import { Hono } from 'hono'
import type { EvlogVariables } from 'evlog/hono'
import { evlogMiddleware } from './evlog'

const app = new Hono<EvlogVariables>()
app.use(evlogMiddleware)`,
    reason: `${entry} is your application file, and splicing a middleware into it is guesswork`,
  })

  return plan
}
