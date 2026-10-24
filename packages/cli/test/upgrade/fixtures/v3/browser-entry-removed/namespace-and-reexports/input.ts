import * as browser from 'evlog/browser'
import { createBrowserLogDrain } from 'evlog/browser'

export { createBrowserDrain, type BrowserLogDrainOptions as Options } from 'evlog/browser'
export { createBrowserLogDrain }
export const drain = browser.createBrowserLogDrain({ drain: { endpoint: '/_evlog' } })
export type Config = import('evlog/browser').BrowserDrainConfig
