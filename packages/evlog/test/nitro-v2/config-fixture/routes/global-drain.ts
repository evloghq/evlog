import { defineEventHandler } from 'h3'
import { globalDrainEvents } from '../plugins/test-global-drain'
import { createLogger } from 'evlog'

export default defineEventHandler(async () => {
  createLogger({ task: 'cleanup' }).emit()
  await new Promise(resolve => setImmediate(resolve))
  return { tasks: globalDrainEvents.map(event => event.task).filter(Boolean) }
})
