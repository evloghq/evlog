import { defineEventHandler } from 'h3'
import { useLogger } from '../../../../../src/runtime/server/useLogger'

export default defineEventHandler(() => {
  const log = useLogger()
  log.set({ viaUseLogger: true })
  void log.fork('matrix_fork', (child) => {
    child.set({ forked: true })
  })
  return { ok: true }
})
