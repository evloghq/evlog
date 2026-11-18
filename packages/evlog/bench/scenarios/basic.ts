import { initLogger, log } from 'evlog'

initLogger({ env: { service: 'my-app' } })

log.info('auth', 'User logged in')
log.info({ userId: 'usr_abc123', action: 'checkout', cart: { items: 3, total: 9999 } })
