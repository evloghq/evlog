import { createLoggerStorage, defineFrameworkIntegration } from 'evlog/toolkit'
import { type LoggerStorage } from 'evlog/toolkit/storage'

export const storage: LoggerStorage = createLoggerStorage('h3')
export const integration = defineFrameworkIntegration({ name: 'h3' })
