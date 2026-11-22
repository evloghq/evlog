import { auditDiff } from 'evlog'
import { billingAudit } from '~~/server/utils/audit'

/**
 * Catalog audit emission. Equivalent of `server/api/audit/refund.post.ts`
 * but the `action` and `target.type` come from `billingAudit` instead of
 * being passed as magic strings.
 *
 * Wire shape:
 *   - audit.action: 'billing.INVOICE_REFUND' (auto-derived)
 *   - audit.target: { id: 'inv_889', type: 'invoice' } (type auto-injected)
 */
export default defineEventHandler(async (event) => {
  const log = useLogger(event)

  log.set({
    payment: { amount: 9999, currency: 'USD', method: 'card' },
    flow: 'catalog_audit_demo',
  })

  const before = { status: 'paid', refundedAmount: 0 }
  const after = { status: 'refunded', refundedAmount: 9999 }

  await log.audit(billingAudit.INVOICE_REFUND({
    actor: { type: 'user', id: 'usr_42', email: 'demo@evlog.dev' },
    target: { id: 'inv_889' },
    outcome: 'success',
    reason: 'Customer requested refund (catalog demo)',
    changes: auditDiff(before, after),
  }))

  return { ok: true, transactionId: 'txn_catalog_456', action: billingAudit.INVOICE_REFUND.action }
})
