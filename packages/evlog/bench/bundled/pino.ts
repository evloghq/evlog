import pino from 'pino'

const logger = pino({ level: 'info' })

logger.info('User logged in')
logger.info({ userId: 'usr_abc123', action: 'checkout', cart: { items: 3, total: 9999, currency: 'USD' }, region: 'us-east-1', sessionId: 'sess_xyz789' }, 'checkout')
