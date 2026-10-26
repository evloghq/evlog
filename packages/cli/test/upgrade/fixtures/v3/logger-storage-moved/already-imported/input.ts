import { createLoggerStorage, defineFrameworkIntegration } from 'evlog/toolkit'
import { createLoggerStorage } from 'evlog/toolkit/storage'

export const { storage } = createLoggerStorage('elysia')
export const integration = defineFrameworkIntegration({ name: 'elysia' })
