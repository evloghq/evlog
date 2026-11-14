import browser from '@agent-browser/eve'
import { ALLOWED_BROWSER_DOMAINS } from '../lib/capture'

/**
 * Browser bounded to evlog's own surfaces (list shared with the capture
 * tool's own gate). `*.vercel.app` is the narrowest bound that keeps
 * hash-named preview deployments reachable; a protected preview's redirect to
 * vercel.com falls outside the list and is blocked. Loopback is allowed
 * because the sandbox runs no listener Evi did not start herself. The
 * extension exposes no cookie/storage/auth-state commands, so session state
 * is never readable through the tool surface; pages can still set runtime
 * cookies while a session lives.
 */
export default browser({
  allowedDomains: [...ALLOWED_BROWSER_DOMAINS],
  contentBoundaries: true,
  maxOutputChars: 50_000,
  inlineScreenshots: true,
  // One browser per sandbox, so a fixed name is unique.
  session: 'evi',
})
