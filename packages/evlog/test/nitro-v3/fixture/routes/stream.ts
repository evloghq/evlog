import { defineHandler } from 'nitro/h3'
import { useLogger } from 'evlog'

export default defineHandler((event) => {
  const log = useLogger(event)

  log.set({ stream: { kind: 'sse' } })

  const encoder = new TextEncoder()
  // The second pull runs only once the first chunk was read, after the response hook.
  let pulls = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++
      if (pulls === 1) {
        controller.enqueue(encoder.encode('data: one\n\n'))
        return
      }
      log.set({ stream: { late: true } })
      controller.enqueue(encoder.encode('data: two\n\n'))
      controller.close()
    },
  })

  return new Response(body, {
    status: 207,
    headers: { 'content-type': 'text/event-stream' },
  })
})
