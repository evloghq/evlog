import { defineHandler, readBody } from 'nitro/h3'
import { useLogger } from 'evlog/nitro'
import { createError } from 'evlog'

export default defineHandler(async (event) => {
  const log = useLogger(event)
  const body = await readBody(event) as { name: string; version: string }

  log.set({ user: { id: 999 } })
  log.set({ action: 'update_item', item: { name: body.name, version: body.version } })

  // Simulate validation check
  await new Promise(resolve => setTimeout(resolve, 100))
  log.set({ validation: { checked: true } })

  // Simulate permission check that always fails
  await new Promise(resolve => setTimeout(resolve, 150))
  log.set({ permissions: { checked: true, hasUpdate: false, requiredRole: 'admin' } })

  throw createError({
    message: 'Update failed',
    status: 403,
    why: 'Insufficient permissions to update this resource',
    fix: 'Request admin privileges or contact your team lead',
    link: 'https://docs.example.com/permissions',
  })
})
