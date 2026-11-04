import type { H3Event } from 'h3'
import type { RuntimeConfig } from 'nuxt/schema'

/**
 * The password gate is opt-in: it only activates once `ANALYTICS_PASSWORD`
 * is set. Unset locally (or in a quick demo deploy) and the dashboard is
 * open — no login required.
 */
export function isAuthEnabled(): boolean {
  return !!process.env.ANALYTICS_PASSWORD
}

/** No-op when the password gate is disabled; otherwise delegates to `nuxt-auth-utils`. */
export async function requireDashboardSession(event: H3Event): Promise<void> {
  if (!isAuthEnabled()) return
  await requireUserSession(event)
}

/**
 * `nuxt-auth-utils` seals the session cookie with a key Nuxt derives from
 * `appSecret` (`NUXT_APP_SECRET`), which must be 32+ characters. Unset or too
 * short (often from reusing `ANALYTICS_PASSWORD`), the derivation throws
 * inside `setUserSession`, after the password check already passed. Checking
 * upfront lets the login route fail with an error that names the variable.
 */
export function isSessionSecretValid(config: Pick<RuntimeConfig, 'appSecret'>): boolean {
  return !!config.appSecret && config.appSecret.length >= 32
}
