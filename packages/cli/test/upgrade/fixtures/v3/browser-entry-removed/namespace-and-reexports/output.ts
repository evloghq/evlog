import * as browser from 'evlog/http'
import { createHttpLogDrain } from 'evlog/http'

export { createHttpDrain as createBrowserDrain, type HttpLogDrainOptions as Options } from 'evlog/http'
export { createHttpLogDrain as createBrowserLogDrain }
export const drain = browser.createHttpLogDrain({ drain: { endpoint: '/_evlog' } })
export type Config = import('evlog/http').HttpDrainConfig
