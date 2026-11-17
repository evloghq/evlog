import { defineHandler } from 'nitro/h3'
import { useLogger } from '../../../../../src/nitro-v3/useLogger'

export default defineHandler(() => {
  const log = useLogger()
  log.set({ viaUseLogger: true })
  void log.fork('matrix_fork', (child) => {
    child.set({ forked: true })
  })
  return { ok: true }
})
