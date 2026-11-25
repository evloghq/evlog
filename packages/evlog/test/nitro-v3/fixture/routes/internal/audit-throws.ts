import { defineHandler } from 'nitro/h3'
import { createError, useLogger } from 'evlog'

export default defineHandler((event) => {
  useLogger(event).audit({ action: 'token.revoke', actor: { type: 'user', id: 'usr_42' }, target: { type: 'token', id: 'tok_99' } })
  throw createError({ message: 'Revocation failed', status: 500 })
})
