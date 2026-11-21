import { defineTool } from 'eve/tools'
import { z } from 'zod'

export default defineTool({
  description: 'Issue a refund for an order.',
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  execute({ orderId, amount }) {
    if (amount > 500) throw new Error('Refund above the limit')
    return { refunded: orderId }
  },
})
