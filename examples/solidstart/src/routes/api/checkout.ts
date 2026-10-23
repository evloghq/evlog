import type { APIEvent } from '@solidjs/start/server'
import { createError } from 'evlog'
import { useLogger } from 'evlog/nitro/v2'

// eslint-disable-next-line
export function POST(event: APIEvent) {
  const log = useLogger(event.nativeEvent)

  log.set({ user: { id: 'user_123', plan: 'pro' } })
  log.set({ cart: { items: 3, total: 9999 } })

  // Simulate payment failure
  const error = createError({
    message: 'Payment failed',
    status: 402,
    why: 'Card declined by issuer',
    fix: 'Try a different payment method',
  })

  log.error(error, { step: 'payment' })

  return Response.json(error.toJSON(), { status: 402 })
}
