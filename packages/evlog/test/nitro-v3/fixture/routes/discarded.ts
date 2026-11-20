import { defineHandler } from 'nitro/h3'
import { useLogger } from 'evlog'

export default defineHandler((event) => {
  const log = useLogger(event)

  log.set({ digest: { recipients: 0 } })
  log.discard()

  return { success: true }
})
