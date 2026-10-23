import { defineEventHandler } from 'h3'
import { useLogger } from 'evlog/nitro/v2'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  await new Promise(resolve => setTimeout(resolve, 100))
  logger.set({
    user: {
      id: 'user_789',
      email: 'demo@example.com',
      plan: 'enterprise',
      accountAge: '2 years',
      role: 'admin',
      mfaEnabled: true,
      lastLogin: '2024-01-15T10:30:00Z',
    },
    session: {
      id: 'sess_abc123',
      device: 'desktop',
      browser: 'Chrome 120',
      os: 'macOS 14.2',
      ip: '192.168.1.42',
      country: 'FR',
      city: 'Paris',
    },
  })

  await new Promise(resolve => setTimeout(resolve, 100))
  logger.set({
    cart: {
      id: 'cart_xyz789',
      items: 5,
      total: 24999,
      currency: 'USD',
      discount: {
        code: 'WINTER25',
        percent: 25,
        savings: 8333,
      },
      products: [
        { sku: 'PRO-001', name: 'Pro License', qty: 2 },
        { sku: 'ADD-002', name: 'Premium Support', qty: 1 },
        { sku: 'ADD-003', name: 'Custom Branding', qty: 2 },
      ],
    },
  })

  await new Promise(resolve => setTimeout(resolve, 100))
  logger.set({
    checkout: {
      step: 'payment',
      paymentMethod: 'card',
      cardBrand: 'visa',
      cardLast4: '4242',
      billingAddress: {
        country: 'US',
        state: 'CA',
        city: 'San Francisco',
        zip: '94102',
      },
      shippingMethod: 'express',
      estimatedDelivery: '2024-01-18',
    },
  })

  await new Promise(resolve => setTimeout(resolve, 100))
  logger.set({
    inventory: {
      checked: 5,
      available: 5,
      reserved: 5,
      warehouse: 'us-west-2',
    },
    fraud: {
      score: 12,
      riskLevel: 'low',
      checks: ['velocity', 'geolocation', 'device_fingerprint'],
      passed: true,
    },
  })

  await new Promise(resolve => setTimeout(resolve, 100))
  logger.set({
    performance: {
      dbQueries: 8,
      dbTime: 45,
      cacheHits: 12,
      cacheMisses: 2,
      externalCalls: 3,
      externalTime: 120,
    },
    flags: {
      newCheckoutFlow: true,
      betaPaymentUI: false,
      experimentId: 'exp_checkout_v2',
    },
  })

  return {
    success: true,
    message: 'Wide event demo',
    orderId: 'ord_abc123xyz',
  }
})
