import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const evlogDir = dirname(fileURLToPath(import.meta.resolve('evlog/nitro/v2')))
const plugin = require.resolve("evlog/nitro")
const { useLogger } = await import('evlog/nitro')

export { evlogDir, plugin, useLogger }
