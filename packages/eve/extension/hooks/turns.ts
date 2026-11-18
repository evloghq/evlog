import { defineHook } from 'eve/hooks'
import { onErrorCreated } from 'evlog/toolkit'
import { emitTurn, isReplaying } from '../lib/emit'
import { toRecordedError } from '../lib/logger'
import { turnSlot } from '../lib/state'

onErrorCreated((error) => {
  if (isReplaying()) return
  try {
    turnSlot.update(slot => ({ ...slot, created: [...slot.created, toRecordedError(error)] }))
  } catch {
    // eve state only exists inside code eve runs; an error built elsewhere belongs to no turn.
  }
})

export default defineHook({
  events: {
    'turn.started'(event) {
      turnSlot.update(() => ({ turnId: event.data.turnId, calls: [], created: [] }))
    },
    async 'turn.settled'(event, ctx) {
      const slot = turnSlot.get()
      await emitTurn(event.data.turnId, slot.turnId === event.data.turnId ? slot : { calls: [], created: [] }, ctx)
    },
  },
})
