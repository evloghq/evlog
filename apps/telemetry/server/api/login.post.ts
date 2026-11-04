import { z } from 'zod'

const loginBodySchema = z.object({
  password: z.string(),
})

/** `POST /api/login` — single shared password gate for the dashboard. */
export default defineEventHandler(async (event) => {
  const log = useLogger(event)

  const expected = process.env.ANALYTICS_PASSWORD
  if (!expected) {
    throw telemetryErrors.LOGIN_NOT_CONFIGURED()
  }

  if (!isSessionSecretValid(useRuntimeConfig())) {
    throw telemetryErrors.SESSION_SECRET_TOO_SHORT()
  }

  const { password } = await readValidatedBody(event, body => loginBodySchema.parse(body))
  const success = verifyDashboardPassword(password, expected)
  log.set({ auth: { outcome: success ? 'success' : 'failure' } })

  if (!success) {
    throw telemetryErrors.INVALID_PASSWORD()
  }

  await setUserSession(event, { user: { role: 'viewer' } })
  return { ok: true }
})
