import { createHttpDrain, type HttpDrainConfig } from 'evlog/http'

const config: HttpDrainConfig = { endpoint: '/_evlog' }
const drain = createHttpDrain(config)
const drains = { createBrowserDrain: createHttpDrain, other: drain }
const label = drains.createBrowserDrain.name

export { drain, label }
