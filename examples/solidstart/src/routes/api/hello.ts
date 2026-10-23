import type { APIEvent } from '@solidjs/start/server'
import { useLogger } from 'evlog/nitro/v2'

// eslint-disable-next-line
export function GET(event: APIEvent) {
  const log = useLogger(event.nativeEvent)
  log.set({ action: 'hello' })
  return Response.json({ ok: true })
}
