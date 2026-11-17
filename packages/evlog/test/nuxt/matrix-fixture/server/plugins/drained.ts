import type { WideEvent } from '../../../../../src/types'

export const drained: WideEvent[] = []

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', ({ event }) => {
    drained.push(event)
  })
})
