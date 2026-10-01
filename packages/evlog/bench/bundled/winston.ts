import winston from 'winston'

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
})

logger.info('User logged in')
logger.info('checkout', { userId: 'usr_abc123', action: 'checkout', cart: { items: 3, total: 9999, currency: 'USD' }, region: 'us-east-1', sessionId: 'sess_xyz789' })
