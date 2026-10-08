import { beforeEach, describe, expect, it, vi } from 'vitest'

const getVercelOidcToken = vi.hoisted(() => vi.fn<() => Promise<string>>())
vi.mock('@vercel/oidc', () => ({ getVercelOidcToken }))

async function loadGateway(env: Record<string, string>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  return await import('./gateway')
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  getVercelOidcToken.mockReset()
})

describe('gatewayToken', () => {
  it('authenticates with the deployment OIDC token when no API key is set', async () => {
    getVercelOidcToken.mockResolvedValue('oidc-token')
    const { gatewayToken } = await loadGateway({ AI_GATEWAY_API_KEY: '' })
    await expect(gatewayToken()).resolves.toBe('oidc-token')
  })

  it('prefers AI_GATEWAY_API_KEY when it is set', async () => {
    getVercelOidcToken.mockResolvedValue('oidc-token')
    const { gatewayToken } = await loadGateway({ AI_GATEWAY_API_KEY: ' vck_key ' })
    await expect(gatewayToken()).resolves.toBe('vck_key')
    expect(getVercelOidcToken).not.toHaveBeenCalled()
  })

  it('fails with AI_GATEWAY_NOT_CONFIGURED when neither credential is available', async () => {
    getVercelOidcToken.mockRejectedValue(new Error('no token'))
    const { gatewayToken } = await loadGateway({ AI_GATEWAY_API_KEY: '' })
    await expect(gatewayToken()).rejects.toMatchObject({ code: 'evi.AI_GATEWAY_NOT_CONFIGURED' })
  })
})

describe('gatewayRouting', () => {
  it('routes with zero data retention enabled', async () => {
    const { gatewayRouting } = await loadGateway({})
    expect(gatewayRouting().zeroDataRetention).toBe(true)
  })

  it('sorts a surface with someone waiting on time to first token', async () => {
    const { gatewayRouting } = await loadGateway({})
    expect(gatewayRouting().sort).toBe('ttft')
    expect(gatewayRouting(false).sort).toBe('ttft')
  })

  it('sorts an unattended run on cost', async () => {
    const { gatewayRouting } = await loadGateway({})
    expect(gatewayRouting(true).sort).toBe('cost')
  })

  it('names no provider, so the sort is what picks the deployment', async () => {
    const { gatewayRouting } = await loadGateway({})
    expect(gatewayRouting()).not.toHaveProperty('order')
  })
})

describe('sessionTags', () => {
  it('tags one dimension per tag: environment and surface', async () => {
    const { sessionTags } = await loadGateway({ VERCEL_ENV: 'production' })
    expect(sessionTags('channel:github')).toEqual(['evi:env:production', 'evi:surface:github'])
  })

  it('labels eval runs from EVE_RUN_MODE ahead of VERCEL_ENV', async () => {
    const { sessionTags } = await loadGateway({ EVE_RUN_MODE: 'eval', VERCEL_ENV: 'production' })
    expect(sessionTags('http')).toEqual(['evi:env:eval', 'evi:surface:http'])
  })

  it('falls back to local environment and unknown surface', async () => {
    const { sessionTags } = await loadGateway({})
    expect(sessionTags()).toEqual(['evi:env:local', 'evi:surface:unknown'])
  })
})

describe('defaultReportTags', () => {
  it('parses the env list and falls back to the attribution tag when it is empty or blank', async () => {
    const { defaultReportTags } = await loadGateway({ AI_GATEWAY_REPORT_TAGS: ' evi:env:production , evi:surface:github ' })
    expect(defaultReportTags()).toEqual(['evi:env:production', 'evi:surface:github'])
    const blank = await loadGateway({ AI_GATEWAY_REPORT_TAGS: ' , ', VERCEL_ENV: 'production' })
    expect(blank.defaultReportTags()).toEqual(['evi:env:production'])
  })
})

describe('reportQuery', () => {
  it('scopes by key name when one is configured and no grouping was requested', async () => {
    const { reportQuery } = await loadGateway({ AI_GATEWAY_REPORT_API_KEY_NAME: 'evi-key' })
    expect(reportQuery({})).toEqual({
      groupBy: 'api_key_name',
      tags: undefined,
      tagsMatch: undefined,
      keyName: 'evi-key',
    })
  })

  it('lets an explicit groupBy win and falls back to tag scoping', async () => {
    const { reportQuery } = await loadGateway({ AI_GATEWAY_REPORT_API_KEY_NAME: 'evi-key', VERCEL_ENV: 'production' })
    expect(reportQuery({ groupBy: 'tag' })).toEqual({
      groupBy: 'tag',
      tags: ['evi:env:production'],
      tagsMatch: 'all',
      keyName: undefined,
    })
  })

  it('defaults to model grouping over the default tags when no key name is configured', async () => {
    const { reportQuery } = await loadGateway({ VERCEL_ENV: 'production' })
    expect(reportQuery({ tags: ['evi:surface:github'], tagsMatch: 'any' })).toEqual({
      groupBy: 'model',
      tags: ['evi:surface:github'],
      tagsMatch: 'any',
      keyName: undefined,
    })
  })
})

describe('reportWindowProblem', () => {
  it('accepts a window that ends today', async () => {
    const { reportWindowProblem } = await loadGateway({})
    expect(reportWindowProblem('2026-10-01', '2026-10-08', '2026-10-08')).toBeUndefined()
  })

  it('rejects a window whose end date has not happened yet', async () => {
    const { reportWindowProblem } = await loadGateway({})
    expect(reportWindowProblem('2026-02-07', '2027-03-07', '2026-10-08')).toEqual({
      field: 'endDate',
      message: 'endDate is in the future: the window ends 2027-03-07 but today is 2026-10-08 (UTC), and the gateway has no data for dates that have not happened yet',
    })
  })

  it('rejects an inverted window', async () => {
    const { reportWindowProblem } = await loadGateway({})
    expect(reportWindowProblem('2026-10-08', '2026-10-01', '2026-10-08')).toEqual({
      field: 'startDate',
      message: 'startDate must not be later than endDate',
    })
  })
})

describe('todayUtc', () => {
  it('returns the UTC calendar date regardless of the local clock', async () => {
    const { todayUtc } = await loadGateway({})
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-08T23:30:00Z'))
      expect(todayUtc()).toBe('2026-10-08')
      vi.setSystemTime(new Date('2026-10-09T00:30:00Z'))
      expect(todayUtc()).toBe('2026-10-09')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('scopedReport', () => {
  const payload = {
    results: [
      { api_key_name: 'EVI-KEY', cost: 1 },
      { api_key_name: 'other', cost: 2 },
    ],
  }

  it('filters key-name scoped rows case-insensitively and stamps the scope receipt', async () => {
    const { reportQuery, scopedReport } = await loadGateway({ AI_GATEWAY_REPORT_API_KEY_NAME: 'evi-key' })
    const report = scopedReport(payload, reportQuery({}))
    expect(report.results).toEqual([{ api_key_name: 'EVI-KEY', cost: 1 }])
    expect(report.scope).toMatchObject({ mode: 'api_key_name', apiKeyName: 'evi-key', matchedRows: 1 })
  })

  it('passes tag-scoped rows through, warning against account-wide fallbacks', async () => {
    const { reportQuery, scopedReport } = await loadGateway({})
    const report = scopedReport(payload, reportQuery({ groupBy: 'tag' }))
    expect(report.results).toHaveLength(2)
    expect(report.scope).toMatchObject({ mode: 'tags', groupBy: 'tag', matchedRows: 2 })
    expect(report.scope.note).toContain('Do not fall back to account-wide totals')
  })

  it('reports zero matches rather than widening to the account', async () => {
    const { reportQuery, scopedReport } = await loadGateway({ AI_GATEWAY_REPORT_API_KEY_NAME: 'missing' })
    const report = scopedReport({ results: [] }, reportQuery({}))
    expect(report.results).toEqual([])
    expect(report.scope.note).toContain('Do not quote account-wide totals')
  })
})

describe('gatewayFetch', () => {
  it('sends the query params and the bearer token, and returns the parsed body', async () => {
    const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify({ balance: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { gatewayFetch } = await loadGateway({ AI_GATEWAY_API_KEY: ' vck_key ' })
    await expect(gatewayFetch('/report', { start_date: '2026-01-01', group_by: undefined })).resolves.toEqual({ balance: 1 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://ai-gateway.vercel.sh/v1/report?start_date=2026-01-01')
    expect(init.headers).toEqual({ Authorization: 'Bearer vck_key' })
  })

  it('maps a non-ok response to AI_GATEWAY_REQUEST_FAILED with the body in internal', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))))
    const { gatewayFetch } = await loadGateway({ AI_GATEWAY_API_KEY: 'key' })
    await expect(gatewayFetch('/credits')).rejects.toMatchObject({
      code: 'evi.AI_GATEWAY_REQUEST_FAILED',
      internal: { body: 'boom' },
    })
  })
})
