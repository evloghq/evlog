import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const evlogDir = dirname(fileURLToPath(import.meta.resolve('evlog/nitro')))
const plugin = require.resolve("evlog/nitro/v3")
const { useLogger } = await import('evlog/nitro/v3')

export { evlogDir, plugin, useLogger }
