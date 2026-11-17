import { definePlugin } from 'nitro'
import type { WideEvent } from '../../../../src/types'

export const drained: WideEvent[] = []

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', ({ event }) => {
    drained.push(event)
  })
})
