import { createHash, timingSafeEqual } from 'node:crypto'
import type { SessionAuthContext } from 'eve/context'

/** The principal maintainer bearer sessions run under; trusted as the maintainer when the token is configured. */
export const MCP_PRINCIPAL = 'mcp:hugo'

/**
 * The `EVI_MAINTAINER_TOKEN` bearer admits the maintainer on the MCP and web
 * channels, deliberately: single-user surface, no OAuth authorization server.
 * eve has no stock static-bearer strategy, so this AuthFn is ours:
 * constant-time comparison via digests (so neither token length nor prefix
 * leaks through timing), nobody admitted while the token is unconfigured. The
 * minted `mcp:hugo` principal is what agent/lib/trust.ts trusts as the
 * maintainer, and eve binds invocation ownership to it.
 */
export function maintainerBearerAuth(request: Request): SessionAuthContext | null {
  const expected = process.env.EVI_MAINTAINER_TOKEN?.trim()
  const authorization = request.headers.get('authorization')
  if (!expected || !authorization?.startsWith('Bearer ')) return null
  const presented = authorization.slice('Bearer '.length).trim()
  if (presented.length === 0) return null
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(expected).digest()
  if (!timingSafeEqual(a, b)) return null
  return {
    attributes: {},
    authenticator: 'mcp-bearer',
    principalId: MCP_PRINCIPAL,
    principalType: 'user',
  }
}
