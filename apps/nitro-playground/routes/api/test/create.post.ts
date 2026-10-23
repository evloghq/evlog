import { defineHandler, readBody } from 'nitro/h3'
import { useLogger } from 'evlog/nitro'

export default defineHandler(async (event) => {
  const log = useLogger(event)
  const body = await readBody(event) as { name: string; type: string }

  log.set({ user: { id: 456 } })
  log.set({ item: { name: body.name, type: body.type } })

  // Simulate validation
  await new Promise(resolve => setTimeout(resolve, 100))
  log.set({ validation: { passed: true, checks: ['name_length', 'type_valid'] } })

  // Simulate database insert
  await new Promise(resolve => setTimeout(resolve, 200))
  const itemId = `item_${Math.random().toString(36).substring(2, 8)}`
  log.set({ database: { operation: 'insert', duration: '200ms' } })

  // Simulate search indexing
  await new Promise(resolve => setTimeout(resolve, 80))
  log.set({ search: { indexed: true, engine: 'elasticsearch' } })

  return {
    success: true,
    message: 'Item created',
    id: itemId,
  }
})
