import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { WiringInput, WiringPlan } from '../../init/wiring'
import { addFile, middlewareModuleTemplate } from '../../init/wiring'

export default function planFastify(input: WiringInput): WiringPlan {
  const plan: WiringPlan = { actions: [], manual: [], already: [] }
  const useSrc = existsSync(join(input.root, 'src'))
  const relativePath = useSrc ? join('src', 'evlog.ts') : 'evlog.ts'
  addFile(plan, input, relativePath, middlewareModuleTemplate(input, {
    source: 'evlog/fastify',
    imports: [`import type { EvlogFastifyOptions } from 'evlog/fastify'`],
    declare: options => `/** Register once, before your routes: \`await app.register(evlog, evlogOptions)\`. */\nexport { evlog }\nexport const evlogOptions: EvlogFastifyOptions = ${options ?? '{}'}`,
  }))

  const entry = useSrc ? join('src', 'index.ts') : 'index.ts'
  plan.manual.push({
    title: 'Register the plugin on your app',
    file: entry,
    snippet: `import Fastify from 'fastify'
import { evlog, evlogOptions } from './evlog'

const app = Fastify({ logger: false })
await app.register(evlog, evlogOptions)`,
    reason: `${entry} is your application file, and splicing a plugin into it is guesswork`,
  })

  return plan
}
