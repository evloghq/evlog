import type { WideEvent } from '../../../../src/types'
import { initLogger } from 'evlog'

export const globalDrainEvents: WideEvent[] = []

export default defineNitroPlugin(() => {
  initLogger({
    drain: ({ event }) => {
      globalDrainEvents.push(event)
    },
  })
})
