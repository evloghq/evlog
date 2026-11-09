import { describe, it } from 'vitest'
import { resolveClickHouseUrl } from '../../src/adapters/clickhouse'
import { resolveDatadogIntakeUrl } from '../../src/adapters/datadog'
import { resolveLokiPushUrl } from '../../src/adapters/loki'
import { toSazabiOTLPEndpoint } from '../../src/adapters/sazabi'
import { expectLinearTime } from '../helpers/timers'

describe('drain endpoint URLs', () => {
  it('trim trailing slashes in linear time', () => {
    const endpoint = `https://in.example.com${'/'.repeat(32_768)}x`
    const resolvers: Array<[string, (url: string) => string]> = [
      ['clickhouse', url => resolveClickHouseUrl({ endpoint: url })],
      ['datadog intakeUrl', url => resolveDatadogIntakeUrl({ intakeUrl: url })],
      ['datadog site', url => resolveDatadogIntakeUrl({ site: url })],
      ['loki', resolveLokiPushUrl],
      ['sazabi', toSazabiOTLPEndpoint],
    ]
    for (const [name, resolve] of resolvers) {
      expectLinearTime(resolve, endpoint, name)
    }
  })
})
