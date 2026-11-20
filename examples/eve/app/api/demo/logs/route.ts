import { readFsLogs } from 'evlog/fs'

export const dynamic = 'force-dynamic'

const MAX_EVENTS = 48

export async function GET() {
  // Every stored event, to whoever asks: only `next dev` serves it.
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 404 })
  const events = []

  try {
    for await (const event of readFsLogs()) {
      events.push(event)
    }
  } catch {
    return Response.json({ events: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }

  return Response.json(
    { events: events.slice(-MAX_EVENTS).reverse() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
