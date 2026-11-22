import { auditDiff } from 'evlog'

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  const userId = 'usr_42'

  log.set({
    payment: { amount: 9999, currency: 'USD', method: 'card' },
    action: 'refund_invoice',
  })

  const before = { status: 'paid', refundedAmount: 0 }
  const after = { status: 'refunded', refundedAmount: 9999 }

  await log.audit({
    action: 'invoice.refund',
    actor: { type: 'user', id: userId, email: 'demo@evlog.dev' },
    target: { type: 'invoice', id: 'inv_889' },
    tenantId: 'tenant_demo',
    outcome: 'success',
    reason: 'Customer requested refund',
    changes: auditDiff(before, after),
  })

  return { ok: true, transactionId: 'txn_456' }
})
