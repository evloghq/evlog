import { createError, createLogger, initLogger, log } from 'evlog'

initLogger({ env: { service: 'my-app' } })

log.info('auth', 'User logged in')
log.info({ userId: 'usr_abc123', action: 'checkout', cart: { items: 3, total: 9999, currency: 'USD' }, region: 'us-east-1', sessionId: 'sess_xyz789' })

const event = createLogger({ jobId: 'job_1', queue: 'emails' })
event.set({ batch: { size: 50 } })
event.emit()

createError({
  message: 'Payment failed',
  status: 402,
  why: 'Card declined by issuer',
  fix: 'Try a different payment method',
})
