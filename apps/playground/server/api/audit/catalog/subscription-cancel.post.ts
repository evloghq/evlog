import { billingAudit } from '~~/server/utils/audit'

/**
 * Catalog audit with a different `target.type` (`subscription`) — proves the
 * type is fixed per entry, not per call site.
 */
export default defineEventHandler(async (event) => {
  const log = useLogger(event)

  log.set({
    flow: 'catalog_audit_demo',
    plan: { id: 'plan_pro', tier: 'pro' },
  })

  await log.audit(billingAudit.SUBSCRIPTION_CANCEL({
    actor: { type: 'user', id: 'usr_42', email: 'demo@evlog.dev' },
    target: { id: 'sub_demo_x77' },
    outcome: 'success',
    reason: 'User cancelled mid-trial',
  }))

  return { ok: true, action: billingAudit.SUBSCRIPTION_CANCEL.action }
})
