import { defineHandler } from 'nitro/h3'
import { createLogger } from '../../../../src/logger'
import { globalDrainEvents } from '../plugins/test-global-drain'

export default defineHandler(async () => {
  globalDrainEvents.length = 0
  createLogger({ task: 'cleanup' }).emit()
  await new Promise(resolve => setImmediate(resolve))
  return { tasks: globalDrainEvents.map(event => event.task).filter(Boolean) }
})
