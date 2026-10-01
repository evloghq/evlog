import { afterEach, describe, expect, it, vi } from 'vitest'
import { MCP_PRINCIPAL, maintainerBearerAuth } from './maintainer-auth'

function request(authorization?: string): Request {
  return new Request('https://evi.example/eve/v1/mcp', {
    method: 'POST',
    headers: authorization === undefined ? {} : { authorization },
  })
}

describe('maintainerBearerAuth', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('mints the maintainer-trusted principal for the exact configured token', () => {
    vi.stubEnv('EVI_MAINTAINER_TOKEN', 'tok-123')
    expect(maintainerBearerAuth(request('Bearer tok-123'))).toMatchObject({
      authenticator: 'mcp-bearer',
      principalId: MCP_PRINCIPAL,
      principalType: 'user',
    })
  })

  it('rejects wrong, empty, non-bearer, or missing credentials', () => {
    vi.stubEnv('EVI_MAINTAINER_TOKEN', 'tok-123')
    expect(maintainerBearerAuth(request('Bearer tok-124'))).toBeNull()
    expect(maintainerBearerAuth(request('Bearer '))).toBeNull()
    expect(maintainerBearerAuth(request('Basic tok-123'))).toBeNull()
    expect(maintainerBearerAuth(request())).toBeNull()
  })

  it('admits nobody when the token is not configured', () => {
    vi.stubEnv('EVI_MAINTAINER_TOKEN', '')
    expect(maintainerBearerAuth(request('Bearer anything'))).toBeNull()
  })
})
