import * as toolkit from 'evlog/toolkit'

export * from 'evlog/toolkit'

export const { storage } = toolkit.createLoggerStorage('fastify')
export const lazy = () => import('evlog/toolkit').then(m => m.createLoggerStorage('fastify'))
export const legacy = require('evlog/toolkit').createLoggerStorage
