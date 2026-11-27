import type { SQSEvent } from 'aws-lambda'
import { createLogger, initLogger, toLoggerConfig } from 'evlog'
import config from '../evlog.config.ts'
import { processMessage } from '../services.ts'

initLogger(toLoggerConfig(config))

export async function handler(event: SQSEvent) {
  for (const record of event.Records) {
    const log = createLogger({ messageId: record.messageId })

    try {
      log.set({ queue: { name: record.eventSourceARN } })
      await processMessage(JSON.parse(record.body))
    } catch (error) {
      log.error(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      log.emit()
    }
  }
}
