import { createConsola } from 'consola'

const consola = createConsola()

consola.info('User logged in')
consola.info('checkout', { userId: 'usr_abc123', action: 'checkout', cart: { items: 3, total: 9999, currency: 'USD' }, region: 'us-east-1', sessionId: 'sess_xyz789' })
