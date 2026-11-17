import { createLogger, initLogger } from 'evlog'

initLogger({ env: { service: 'my-app' } })

const event = createLogger({ jobId: 'job_1', queue: 'emails' })
event.set({ batch: { size: 50 } })
event.emit()
