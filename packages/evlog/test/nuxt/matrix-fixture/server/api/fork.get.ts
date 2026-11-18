export default defineEventHandler(() => {
  const log = useLogger()
  log.set({ viaUseLogger: true })
  void log.fork('matrix_fork', (child) => {
    child.set({ forked: true })
  })
  return { ok: true }
})
