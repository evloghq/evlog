// ?type=payment_intent.succeeded | charge.refunded
export default defineEventHandler((event) => {
  const log = useLogger(event)
  const { type = 'payment_intent.succeeded' } = getQuery(event)
  const handled = type === 'payment_intent.succeeded'

  log.set({
    webhook: {
      provider: 'stripe',
      type,
      handled,
      ...(handled ? {} : { reason: 'no handler registered for event type' }),
    },
  })

  return { received: true }
})
