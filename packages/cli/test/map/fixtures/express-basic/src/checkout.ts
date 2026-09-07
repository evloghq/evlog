import { Router } from 'express'

const checkout = Router()

checkout.post('/checkout', (req, res) => {
  req.log.set({ user: { id: '123' } })
  req.log.audit({ action: 'checkout.completed', actor: { type: 'user', id: '123' } })
  res.json({ ok: true })
})

export default checkout
