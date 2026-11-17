import { createServer } from 'node:http'
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Layer } from 'effect'
import { HttpRouter } from 'effect/http'
import { initLoggerLayer, routerLayer } from 'evlog/effect'
import { CheckoutRoute } from './routes/checkout'
import { HealthRoutes } from './routes/health'
import { UserRoute } from './routes/users'

const Routes = Layer.mergeAll(CheckoutRoute, HealthRoutes, UserRoute)

const Server = HttpRouter.serve(
  Routes.pipe(Layer.provide(routerLayer({ service: 'shop' }))),
  { disableLogger: true },
).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
  Layer.provide(initLoggerLayer({ env: { service: 'shop' } })),
)

NodeRuntime.runMain(Layer.launch(Server))
