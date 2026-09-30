// ?email=notanemail | hugo+test@example.com
export default defineEventHandler((event) => {
  const log = useLogger(event)
  const email = String(getQuery(event).email ?? 'notanemail')

  const reason = !email.includes('@')
    ? 'must be a valid email address'
    : email.includes('+')
      ? 'email must not contain "+"'
      : undefined

  if (reason) {
    log.set({ validation: { field: 'email', value: email, reason } })
    setResponseStatus(event, 400)
    return { error: reason }
  }

  log.set({ user: { email } })
  return { success: true }
})
