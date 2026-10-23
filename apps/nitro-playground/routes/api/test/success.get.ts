import { defineHandler } from 'nitro/h3'
import { useLogger } from 'evlog/nitro'

export default defineHandler(async (event) => {
  const log = useLogger(event)

  log.set({ user: { id: 123, plan: 'pro' } })
  log.set({ action: 'fetch_profile' })

  // Simulate database query
  await new Promise(resolve => setTimeout(resolve, 150))
  const profile = { name: 'John Doe', email: 'john@example.com', lastLogin: new Date().toISOString() }
  log.set({ profile })

  // Simulate cache check
  await new Promise(resolve => setTimeout(resolve, 50))
  log.set({ cache: { hit: true, ttl: 3600 } })

  return {
    success: true,
    message: 'Profile fetched successfully',
    data: profile,
  }
})
