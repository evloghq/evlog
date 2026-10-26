import { defineFrameworkIntegration } from 'evlog/toolkit'
import { createLoggerStorage } from 'evlog/toolkit/storage'

export const { storage } = createLoggerStorage('express')
export const integration = defineFrameworkIntegration({ name: 'express', storage })
export const lazy = () => import('evlog/toolkit/storage')
