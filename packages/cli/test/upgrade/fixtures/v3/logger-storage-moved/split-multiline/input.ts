import {
  createMiddlewareLogger,
  createLoggerStorage as loggerStorage,
  defineFrameworkIntegration,
} from 'evlog/toolkit'

export const { storage } = loggerStorage('koa')
export { createMiddlewareLogger, defineFrameworkIntegration }
