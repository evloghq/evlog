import evlog from 'evlog/nitro'
import { evlogErrorHandler, useLogger } from 'evlog/nitro/v3'
import type { NitroModuleOptions } from 'evlog/nitro'

export { useLogger } from 'evlog/nitro/v3'
export * from 'evlog/nitro'
export const modules = [evlog()]
export const handler = evlogErrorHandler
export type Options = NitroModuleOptions & { log: typeof useLogger }
