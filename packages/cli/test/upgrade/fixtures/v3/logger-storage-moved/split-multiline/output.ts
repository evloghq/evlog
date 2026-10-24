import {
  createMiddlewareLogger,
  defineFrameworkIntegration,
} from 'evlog/toolkit'
import { createLoggerStorage as loggerStorage } from 'evlog/toolkit/storage'

export const { storage } = loggerStorage('koa')
export { createMiddlewareLogger, defineFrameworkIntegration }
