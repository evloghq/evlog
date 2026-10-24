import { createBrowserDrain, type BrowserDrainConfig } from 'evlog/browser'

const config: BrowserDrainConfig = { endpoint: '/_evlog' }
const drain = createBrowserDrain(config)
const drains = { createBrowserDrain, other: drain }
const label = drains.createBrowserDrain.name

export { drain, label }
