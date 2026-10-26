import { defineFrameworkIntegration } from 'evlog/toolkit'
import { type LoggerStorage, createLoggerStorage } from 'evlog/toolkit/storage'

export const storage: LoggerStorage = createLoggerStorage('h3')
export const integration = defineFrameworkIntegration({ name: 'h3' })
