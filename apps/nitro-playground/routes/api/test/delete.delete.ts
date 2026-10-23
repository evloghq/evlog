import { defineHandler } from 'nitro/h3'
import { useLogger } from 'evlog/nitro'

export default defineHandler(async (event) => {
  const log = useLogger(event)
  const itemId = 'item_123'

  log.set({ user: { id: 789 } })
  log.set({ action: 'delete_item', itemId })

  // Simulate permission check
  await new Promise(resolve => setTimeout(resolve, 100))
  log.set({ permissions: { checked: true, hasDelete: true } })

  // Simulate database delete
  await new Promise(resolve => setTimeout(resolve, 150))
  log.set({ database: { operation: 'delete', affected: 1 } })

  // Simulate cache invalidation
  await new Promise(resolve => setTimeout(resolve, 50))
  log.set({ cache: { invalidated: true, keys: [`item:${itemId}`] } })

  return {
    success: true,
    message: 'Item deleted',
    deletedId: itemId,
  }
})
