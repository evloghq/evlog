import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { WiringInput, WiringPlan } from '../../init/wiring'
import { addFile, evlogConfigImport } from '../../init/wiring'

export default function planEffect(input: WiringInput): WiringPlan {
  const plan: WiringPlan = { actions: [], manual: [], already: [] }
  const useSrc = existsSync(join(input.root, 'src'))
  const relativePath = useSrc ? join('src', 'evlog.ts') : 'evlog.ts'
  addFile(plan, input, relativePath, `import { toLoggerConfig, toMiddlewareOptions } from 'evlog'
import { initLoggerLayer, routerLayer } from 'evlog/effect'
import config from '${evlogConfigImport(input, relativePath)}'

/** Provide to the server layer: it starts the logger when the layer builds. */
export const EvlogInit = initLoggerLayer(toLoggerConfig(config))

/** Provide to the HttpRouter routes: one wide event per request, read with \`yield* EvlogLogger\`. */
export const EvlogRouter = routerLayer(toMiddlewareOptions(config))
`)

  const entry = useSrc ? join('src', 'index.ts') : 'index.ts'
  plan.manual.push({
    title: 'Provide the layers to your server',
    file: entry,
    snippet: `import { Layer } from 'effect'
import { HttpRouter } from 'effect/http'
import { EvlogInit, EvlogRouter } from './evlog'

const Server = HttpRouter.serve(
  Routes.pipe(Layer.provide(EvlogRouter)),
  { disableLogger: true },
).pipe(Layer.provide(EvlogInit))`,
    reason: `${entry} builds your server layer, and splicing layers into it is guesswork`,
  })

  return plan
}
