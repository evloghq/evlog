import { defineTool } from 'eve/tools'
import { useLogger } from '@evlog/eve/logger'
import { z } from 'zod'
import { findOrder } from '../lib/support-data.js'
import { fakeLatency } from '../lib/fake-latency.js'

/** Refunds above this amount require human approval in the demo. */
export const REFUND_APPROVAL_THRESHOLD_USD = 100

function orderRequiresApproval(order: { amount: number } | undefined): boolean {
  return (order?.amount ?? 0) > REFUND_APPROVAL_THRESHOLD_USD
}

export default defineTool({
  description: 'Issue a refund on a paid Clearbill order. Amounts over $100 require human approval.',
  inputSchema: z.object({
    orderId: z.string(),
    reason: z.string().describe('Why the customer is getting a refund'),
  }),
  approval: ({ toolInput }) => {
    const order = findOrder(String(toolInput?.orderId ?? ''))
    return orderRequiresApproval(order) ? 'user-approval' : 'not-applicable'
  },
  async execute({ orderId, reason }) {
    await fakeLatency(900, 1600)

    const order = findOrder(orderId)
    if (!order) {
      return { ok: false, error: 'order_not_found', orderId }
    }
    if (order.status === 'refunded') {
      return { ok: false, error: 'already_refunded', orderId }
    }

    const log = useLogger()
    log.set({
      refund: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        reason,
        status: 'refunded',
      },
    })
    log.audit({
      action: 'refund.issued',
      actor: { type: 'agent', id: 'clearbill-support-copilot' },
      target: { type: 'order', id: order.id },
      reason,
    })

    return {
      ok: true,
      refundId: `rfnd_${order.id}`,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      status: 'refunded',
    }
  },
})
