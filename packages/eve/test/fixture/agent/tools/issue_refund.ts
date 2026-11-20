import { useLogger } from '@evlog/eve/logger'
import { defineTool } from 'eve/tools'
import { createError } from 'evlog'
import { z } from 'zod'

export default defineTool({
  description: 'Issue a refund for an order.',
  inputSchema: z.object({ order: z.string() }),
  execute({ order }) {
    useLogger().set({ order: { id: order }, customer: { email: 'jane@example.com' } })
    if (order === 'plain') throw new Error('Refund service timed out')
    // Two declines with one message and different causes, as two calls in one turn.
    if (order === 'card' || order === 'limit') {
      throw createError({
        message: 'Refund declined',
        status: 402,
        code: order === 'card' ? 'CARD_REJECTED' : 'LIMIT_REACHED',
        why: order === 'card' ? 'The card issuer rejected the reversal' : 'The daily refund limit is spent',
      })
    }
    if (order === 'bad') {
      throw createError({
        message: `Refund for order ${order} declined`,
        status: 402,
        code: 'REFUND_DECLINED',
        why: 'The card issuer rejected the reversal',
        fix: 'Ask the customer for another payment method',
      })
    }
    useLogger().audit({ action: 'refund.issued', actor: { type: 'agent', id: 'refund-agent' }, target: { type: 'order', id: order } })
    return { refunded: order }
  },
})
