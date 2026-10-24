import { defineFrameworkIntegration } from 'evlog/toolkit'

type Storage = ReturnType<typeof import('evlog/toolkit/storage').createLoggerStorage>
type Integration = typeof import('evlog/toolkit').defineFrameworkIntegration

export function wire(storage: Storage, integration: Integration) {
  return { storage, integration, defineFrameworkIntegration }
}
