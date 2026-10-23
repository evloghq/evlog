import { defineHandler } from 'nitro/h3'
import { useLogger } from 'evlog/nitro'

export default defineHandler(async (event) => {
  const log = useLogger(event)

  // User context
  await new Promise(resolve => setTimeout(resolve, 80))
  log.set({
    user: {
      id: 'user_789',
      email: 'demo@example.com',
      plan: 'enterprise',
      accountAge: '2 years',
      role: 'admin',
    },
    session: {
      device: 'desktop',
      browser: 'Chrome 120',
      country: 'US',
    },
  })

  // Cart information
  await new Promise(resolve => setTimeout(resolve, 80))
  log.set({
    cart: {
      items: 5,
      total: 24999,
      currency: 'USD',
      discount: {
        code: 'WINTER25',
        savings: 8333,
      },
    },
  })

  // Payment processing
  await new Promise(resolve => setTimeout(resolve, 80))
  log.set({
    payment: {
      method: 'card',
      cardBrand: 'visa',
      cardLast4: '4242',
    },
    fraud: {
      score: 12,
      riskLevel: 'low',
      passed: true,
    },
  })

  // Performance metrics
  await new Promise(resolve => setTimeout(resolve, 80))
  log.set({
    performance: {
      dbQueries: 8,
      cacheHits: 12,
      cacheMisses: 2,
    },
    flags: {
      newCheckoutFlow: true,
      experimentId: 'exp_checkout_v2',
    },
  })

  return {
    success: true,
    message: 'Wide event demo - check your terminal!',
    orderId: 'ord_abc123xyz',
  }
})
