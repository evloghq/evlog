import { createLogger } from 'evlog'

const log = createLogger({ jobId: 'sync-001', queue: 'emails' })

log.emit()
