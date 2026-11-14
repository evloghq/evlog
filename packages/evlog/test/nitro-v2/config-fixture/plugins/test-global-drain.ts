import { initLogger } from '../../../../src/logger'
import type { WideEvent } from '../../../../src/types'

export const globalDrainEvents: WideEvent[] = []

export default defineNitroPlugin(() => {
  initLogger({
    drain: ({ event }) => {
      globalDrainEvents.push(event)
    },
  })
})
