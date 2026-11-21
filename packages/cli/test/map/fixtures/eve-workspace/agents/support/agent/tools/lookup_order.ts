import { useLogger } from '@evlog/eve/logger'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

export default defineTool({
  description: 'Look up an order by id.',
  inputSchema: z.object({ orderId: z.string() }),
  execute({ orderId }) {
    useLogger().set({ order: { id: orderId } })
    return { found: true, orderId }
  },
})
