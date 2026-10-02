import { describe, expect, it } from 'vitest'
import evlog from '../../src/vite/index'

describe('evlog vite plugin', () => {
  it('includes auto-imports when enabled with boolean', () => {
    const plugins = evlog({ service: 'my-app', autoImports: true })
    const names = plugins.map((p: any) => p.name)
    expect(names).toContain('evlog:auto-imports')
  })

  it('includes auto-imports when enabled with object', () => {
    const plugins = evlog({
      service: 'my-app',
      autoImports: { imports: ['log'], dts: false },
    })
    const names = plugins.map((p: any) => p.name)
    expect(names).toContain('evlog:auto-imports')
  })

  it('does not include auto-imports by default', () => {
    const plugins = evlog({ service: 'my-app' })
    const names = plugins.map((p: any) => p.name)
    expect(names).not.toContain('evlog:auto-imports')
  })

  it('includes client-inject when client config is provided', () => {
    const plugins = evlog({ service: 'my-app', client: { service: 'web' } })
    const names = plugins.map((p: any) => p.name)
    expect(names).toContain('evlog:client-inject')
  })

  it('does not include client-inject by default', () => {
    const plugins = evlog({ service: 'my-app' })
    const names = plugins.map((p: any) => p.name)
    expect(names).not.toContain('evlog:client-inject')
  })

  it('includes strip plugin when levels provided', () => {
    const plugins = evlog({ service: 'my-app', strip: ['debug'] })
    const names = plugins.map((p: any) => p.name)
    expect(names).toContain('evlog:strip')
  })

  it('includes strip by default with debug level', () => {
    const plugins = evlog({ service: 'my-app' })
    const names = plugins.map((p: any) => p.name)
    expect(names).toContain('evlog:strip')
  })

  it('disables strip when set to empty array', () => {
    const plugins = evlog({ service: 'my-app', strip: [] })
    const names = plugins.map((p: any) => p.name)
    expect(names).not.toContain('evlog:strip')
  })

  it('includes source-location when enabled', () => {
    const plugins = evlog({ service: 'my-app', sourceLocation: true })
    const names = plugins.map((p: any) => p.name)
    expect(names).toContain('evlog:source-location')
  })

  it('does not include source-location by default', () => {
    const plugins = evlog({ service: 'my-app' })
    const names = plugins.map((p: any) => p.name)
    expect(names).not.toContain('evlog:source-location')
  })

  it('returns auto-init and strip with no options', () => {
    const plugins = evlog()
    const names = plugins.map((p: any) => p.name)
    expect(names).toEqual(['evlog:auto-init', 'evlog:strip'])
  })

  it('includes source-location when set to dev', () => {
    const plugins = evlog({ service: 'my-app', sourceLocation: 'dev' })
    const names = plugins.map((p: any) => p.name)
    expect(names).toContain('evlog:source-location')
  })

  it('does not include source-location when explicitly false', () => {
    const plugins = evlog({ service: 'my-app', sourceLocation: false })
    const names = plugins.map((p: any) => p.name)
    expect(names).not.toContain('evlog:source-location')
  })

  it('preserves plugin order: auto-init, auto-imports, client, strip, source-location', () => {
    const plugins = evlog({
      service: 'my-app',
      autoImports: true,
      strip: ['debug'],
      sourceLocation: true,
      client: { service: 'web' },
    })
    const names = plugins.map((p: any) => p.name)
    expect(names).toEqual([
      'evlog:auto-init',
      'evlog:auto-imports',
      'evlog:client-inject',
      'evlog:strip',
      'evlog:source-location',
    ])
  })
})
