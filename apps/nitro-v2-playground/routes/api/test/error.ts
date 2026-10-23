import { defineEventHandler } from 'h3'
import { useLogger } from 'evlog/nitro/v2'
import { createError } from 'evlog'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  logger.set({
    user: {
      id: 'user_456',
      email: 'jane.smith@startup.io',
      plan: 'free',
      signupDate: '2024-01-10',
      trialEndsAt: '2024-01-25',
    },
    action: 'subscription_upgrade',
    source: 'billing_page',
  })

  await new Promise(resolve => setTimeout(resolve, 200))
  logger.set({
    subscription: {
      currentPlan: 'free',
      targetPlan: 'pro',
      billingCycle: 'annual',
      amount: 9999,
      currency: 'USD',
    },
    pricing: {
      basePrice: 12999,
      discount: 3000,
      discountReason: 'annual_billing',
      tax: 0,
      finalAmount: 9999,
    },
  })

  await new Promise(resolve => setTimeout(resolve, 200))
  logger.set({
    payment: {
      method: 'card',
      cardBrand: 'mastercard',
      cardLast4: '5555',
      cardExpiry: '12/25',
      cardCountry: 'GB',
    },
    processor: {
      name: 'stripe',
      attemptId: 'pi_abc123xyz',
      idempotencyKey: 'idem_456def',
    },
  })

  await new Promise(resolve => setTimeout(resolve, 200))

  logger.error(new Error('Payment processing failed'), {
    paymentMethod: 'card',
    amount: 9999,
    errorCode: 'card_declined',
    declineCode: 'insufficient_funds',
    processorResponse: 'do_not_honor',
    retryable: true,
  })

  logger.emit()

  throw createError({
    status: 400,
    message: 'Payment processing failed',
    why: 'Card declined by issuer',
    fix: 'Try a different payment method',
    link: 'https://docs.example.com/payments/declined',
  })
})
