import type { EvlogFrameworkOptions } from 'evlog/toolkit'
import type { createLoggerStorage } from 'evlog/toolkit/storage'

export type Factory = typeof createLoggerStorage
export type Options = EvlogFrameworkOptions
