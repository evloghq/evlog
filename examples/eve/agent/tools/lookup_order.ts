import { defineTool } from 'eve/tools'
import { useLogger } from '@evlog/eve/logger'
import { z } from 'zod'
import { findOrder } from '../lib/support-data.js'
import { fakeLatency } from '../lib/fake-latency.js'

export default defineTool({
  description: 'Look up a Clearbill order by id (e.g. 4821).',
  inputSchema: z.object({
    orderId: z.string(),
  }),
  async execute({ orderId }) {
    await fakeLatency(350, 750)

    const order = findOrder(orderId)
    if (!order) {
      return { found: false, orderId }
    }

    const log = useLogger()
    log.set({
      order: {
        id: order.id,
        customerSlug: order.customerSlug,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        product: order.product,
      },
    })

    return { found: true, order }
  },
})
