import { defineEventHandler } from 'h3'

export default defineEventHandler(() => (globalThis as { __evlogFinished?: unknown[] }).__evlogFinished ?? [])
