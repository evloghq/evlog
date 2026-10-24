import evlog from 'evlog/nitro/v2'
import { evlogErrorHandler, useLogger } from 'evlog/nitro'
import type { NitroModuleOptions } from 'evlog/nitro/v2'

export { useLogger } from 'evlog/nitro'
export * from 'evlog/nitro/v2'
export const modules = [evlog()]
export const handler = evlogErrorHandler
export type Options = NitroModuleOptions & { log: typeof useLogger }
