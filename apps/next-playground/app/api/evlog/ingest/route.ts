import { NextRequest } from 'next/server'

const VALID_LEVELS = ['info', 'error', 'warn', 'debug', 'fatal', 'trace'] as const

export async function POST(request: NextRequest) {
  // Validate origin
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (origin) {
    const originHost = new URL(origin).host
    if (originHost !== host) {
      return Response.json({ error: 'Invalid origin' }, { status: 403 })
    }
  }

  const body = await request.json()

  // Validate payload
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.timestamp) {
    return Response.json({ error: 'Missing timestamp' }, { status: 400 })
  }

  if (!body.level || !VALID_LEVELS.includes(body.level)) {
    return Response.json({ error: 'Invalid level' }, { status: 400 })
  }

  // Strip client-provided service (server controls this)
  const { service: _clientService, ...sanitizedPayload } = body

  const wideEvent = {
    ...sanitizedPayload,
    service: 'next-playground',
    environment: process.env.NODE_ENV || 'development',
    source: 'client',
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[CLIENT LOG]', JSON.stringify(wideEvent))
  }

  return new Response(null, { status: 204 })
}
