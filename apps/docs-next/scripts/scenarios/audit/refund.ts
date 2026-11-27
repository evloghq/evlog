import { Hono } from 'hono'
import { createError } from 'evlog'
import { evlog, type EvlogVariables } from 'evlog/hono'
import { db } from '../services.ts'
import { respond } from '../respond.ts'

export const app = new Hono<EvlogVariables>()
app.use(evlog())

app.onError(respond)

app.post('/api/invoices/refund', async (c) => {
  const log = c.get('log')
  const { invoiceId, userId } = await c.req.json()

  const user = await db.findStaff(userId)
  const invoice = await db.findInvoice(invoiceId)

  if (!user.canRefund(invoice)) {
    log.audit.deny('Insufficient permissions', {
      action: 'invoice.refund',
      actor: { type: 'user', id: user.id },
      target: { type: 'invoice', id: invoice.id },
    })
    throw createError({ status: 403, message: 'Forbidden' })
  }

  log.audit({
    action: 'invoice.refund',
    actor: { type: 'user', id: user.id, email: user.email },
    target: { type: 'invoice', id: invoice.id },
    outcome: 'success',
    reason: 'Customer requested refund',
  })

  return c.json({ refunded: true })
})
