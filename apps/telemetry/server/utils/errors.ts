import { defineErrorCatalog } from 'evlog'

/**
 * Central catalog of this app's known server errors (self-documenting
 * `why`/`fix` context via evlog's `defineErrorCatalog`).
 *
 * Exported from `server/utils/`, so `telemetryErrors` is auto-imported as a
 * global across `server/**` — same mechanism as `useLogger`/`log`. Routes
 * call `telemetryErrors.SOME_CODE()` instead of `createError()`, which also
 * sidesteps the h3-vs-evlog `createError` auto-import ambiguity for these
 * call sites entirely.
 */
export const telemetryErrors = defineErrorCatalog('telemetry', {
  LOGIN_NOT_CONFIGURED: {
    status: 500,
    message: 'Dashboard login is not configured',
    why: 'ANALYTICS_PASSWORD is not set on the server',
    fix: 'Set ANALYTICS_PASSWORD in the deployment environment (see .env.example), or leave it unset to run without a login gate',
  },
  SESSION_SECRET_TOO_SHORT: {
    status: 500,
    message: 'Dashboard session secret is missing or too short',
    why: 'NUXT_APP_SECRET must be at least 32 characters — the session cookie is sealed with a key derived from it, and it is a different value from ANALYTICS_PASSWORD (the login password you type in). NUXT_SESSION_PASSWORD is no longer read',
    fix: 'Generate a secret with `openssl rand -base64 32` and set it as NUXT_APP_SECRET in the deployment environment, then redeploy',
  },
  INVALID_PASSWORD: {
    status: 401,
    message: 'Invalid password',
  },
  RUN_NOT_FOUND: {
    status: 404,
    message: ({ id }: { id: number }) => `Run ${id} not found`,
    fix: 'Verify the run id from the runs list',
  },
  MCP_UNAUTHORIZED: {
    status: 403,
    message: 'Invalid or missing bearer token',
  },
})
