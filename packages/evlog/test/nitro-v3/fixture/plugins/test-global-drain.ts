import { definePlugin } from 'nitro'
import type { WideEvent } from '../../../../src/types'
import { initLogger } from 'evlog'

export const globalDrainEvents: WideEvent[] = []

export default definePlugin(() => {
  initLogger({
    drain: ({ event }) => {
      globalDrainEvents.push(event)
    },
  })
})
