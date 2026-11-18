import { defineTool } from 'eve/tools'
import { useLogger } from '@evlog/eve/logger'
import { z } from 'zod'
import { findCustomer } from '../lib/support-data.js'
import { fakeLatency } from '../lib/fake-latency.js'

export default defineTool({
  description: 'Look up a Clearbill customer by slug (e.g. acme-corp) or account id.',
  inputSchema: z.object({
    query: z.string().describe('Customer slug, name, or cust_* id'),
  }),
  async execute({ query }) {
    await fakeLatency(450, 950)

    const customer = findCustomer(query)
    if (!customer) {
      return { found: false, query }
    }

    const log = useLogger()
    log.set({
      customer: {
        id: customer.id,
        slug: customer.slug,
        name: customer.name,
        plan: customer.plan,
        mrr: customer.mrr,
        status: customer.status,
      },
    })

    return { found: true, customer }
  },
})
