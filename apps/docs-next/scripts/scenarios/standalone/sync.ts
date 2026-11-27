import { createLogger, initLogger, toLoggerConfig } from 'evlog'
import config from '../evlog.config.ts'
import { sync } from '../services.ts'

initLogger(toLoggerConfig(config))

const log = createLogger({ job: 'sync', source: 'postgres', target: 's3' })

const records = await sync()
log.set({ records: records.length })

log.emit()
