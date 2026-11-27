import { createLogger } from 'evlog'

const user = { id: 'usr_123' }

const log = createLogger({ jobId: 'sync-001', queue: 'emails' })

log.set({ user: { id: user.id } })
log.set({ source: 'postgres', target: 's3' })
log.set({ records: { found: 1250, synced: 1250 } })
log.emit()
