import { createError } from 'evlog'

// ?outcome=ok | silent | upstream
export default defineEventHandler((event) => {
  const log = useLogger(event)
  const { outcome = 'ok' } = getQuery(event)

  log.set({ user: { id: 'user_44', plan: 'free' }, cart: { items: 1, total: 4900, currency: 'USD' } })

  if (outcome === 'upstream') {
    log.set({ payment: { provider: 'stripe', attempt: 1 } })
    throw createError({
      status: 502,
      message: 'request to https://api.stripe.com/v1/payment_intents failed, reason: read ECONNRESET',
      why: 'Stripe did not answer within the client timeout',
      fix: 'Retry with backoff, then fall back to the pending-review path',
    })
  }

  if (outcome === 'silent') {
    log.set({ payment: { provider: 'stripe', status: 'requires_action', fallback: true } })
    return { success: true, message: 'Thanks! We will email you shortly.' }
  }

  log.set({ payment: { provider: 'stripe', status: 'succeeded' }, order: { id: 'ord_9f2', confirmationSent: true } })
  return { success: true, orderId: 'ord_9f2' }
})
