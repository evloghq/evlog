export default defineEventHandler(async (event) => {
  const log = useLogger(event)

  await log.audit.deny('Insufficient permissions to refund this invoice', {
    action: 'invoice.refund',
    actor: { type: 'user', id: 'usr_intruder' },
    target: { type: 'invoice', id: 'inv_889' },
  })

  throw createError({
    status: 403,
    message: 'Forbidden',
    why: 'The current user is not authorised to refund this invoice.',
    fix: 'Sign in as an account owner or contact support.',
  })
})
