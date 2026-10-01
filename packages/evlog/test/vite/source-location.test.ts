import { describe, expect, it } from 'vitest'
import { defined } from '../helpers/defined'
import { callConfigResolved, runPluginTransform } from '../helpers/vite'
import { createSourceLocationPlugin } from '../../src/vite/source-location'

async function sourceLocationTransform(code: string, id = '/project/src/app.ts', root = '/project') {
  const plugin = createSourceLocationPlugin(true)
  return await runPluginTransform(plugin, code, id, { config: { command: 'serve', root } })
}

describe('vite source-location plugin', () => {
  it('injects __source into object-form log calls', async () => {
    const code = `log.info({ action: 'login' })`
    const result = defined(await sourceLocationTransform(code), 'source-location result')
    expect(result.code).toContain('__source')
    expect(result.code).toContain('src/app.ts:1')
  })

  it('handles objects with multiple properties', async () => {
    const code = `log.error({ action: 'payment', error: 'declined' })`
    const result = defined(await sourceLocationTransform(code), 'source-location result')
    expect(result.code).toContain('__source')
    expect(result.code).toContain('action')
    expect(result.code).toContain('error')
  })

  it('does not transform tag-form log calls', async () => {
    const code = `log.info('auth', 'User logged in')`
    const result = await sourceLocationTransform(code)
    expect(result).toBeUndefined()
  })

  it('tracks correct line numbers', async () => {
    const code = `const x = 1\nconst y = 2\nlog.info({ action: 'test' })`
    const result = defined(await sourceLocationTransform(code), 'source-location result')
    expect(result.code).toContain('src/app.ts:3')
  })

  it('handles all log levels', async () => {
    const levels = ['info', 'error', 'warn', 'debug', 'fatal', 'trace']
    for (const level of levels) {
      const code = `log.${level}({ action: 'test' })`
      const result = defined(await sourceLocationTransform(code), 'source-location result')
      expect(result.code).toContain('__source')
    }
  })

  it('skips node_modules', async () => {
    const code = `log.info({ action: 'test' })`
    const result = await sourceLocationTransform(code, '/project/node_modules/lib/index.js')
    expect(result).toBeUndefined()
  })

  it('generates sourcemap', async () => {
    const code = `log.info({ action: 'test' })`
    const result = defined(await sourceLocationTransform(code), 'source-location result')
    expect(result.map).toBeTruthy()
  })

  it('does not activate when disabled', async () => {
    const plugin = createSourceLocationPlugin(false)
    const result = await runPluginTransform(
      plugin,
      `log.info({ action: 'test' })`,
      '/project/src/app.ts',
      { config: { command: 'serve', root: '/project' } },
    )
    expect(result).toBeUndefined()
  })

  it('uses relative path from root', async () => {
    const code = `log.info({ action: 'test' })`
    const result = defined(
      await sourceLocationTransform(code, '/my/project/src/routes/checkout.ts', '/my/project'),
      'source-location result',
    )
    expect(result.code).toContain('src/routes/checkout.ts:1')
  })

  it('injects into empty object', async () => {
    const code = `log.info({})`
    const result = defined(await sourceLocationTransform(code), 'source-location result')
    expect(result.code).toContain('__source')
    expect(result.code).toContain('src/app.ts:1')
  })

  it('injects into multiline object', async () => {
    const code = `log.info({\n  action: 'login',\n  user: 'alice'\n})`
    const result = defined(await sourceLocationTransform(code), 'source-location result')
    expect(result.code).toContain('__source')
  })

  it('injects into object with trailing comma', async () => {
    const code = `log.info({ action: 'login', })`
    const result = defined(await sourceLocationTransform(code), 'source-location result')
    expect(result.code).toContain('__source')
  })

  it('injects into object with nested objects', async () => {
    const code = `log.info({ user: { id: 1, name: 'alice' } })`
    const result = defined(await sourceLocationTransform(code), 'source-location result')
    expect(result.code).toContain('__source')
    expect(result.code).toContain('user')
  })

  it('skips object that already has __source', async () => {
    const code = `log.info({ __source: 'custom', action: 'test' })`
    const result = await sourceLocationTransform(code)
    expect(result).toBeUndefined()
  })

  it('uses JSON.stringify for path escaping', async () => {
    const code = `log.info({ action: 'test' })`
    const result = defined(await sourceLocationTransform(code), 'source-location result')
    expect(result.code).toContain('__source: "src/app.ts:1"')
  })

  it('defaults to dev-only when enabled is undefined', async () => {
    const plugin = createSourceLocationPlugin()
    const code = `log.info({ action: 'test' })`
    const id = '/project/src/app.ts'

    const devResult = await runPluginTransform(plugin, code, id, { config: { command: 'serve', root: '/project' } })
    expect(devResult).toBeTruthy()

    await callConfigResolved(plugin, { command: 'build', root: '/project' })
    const buildResult = await runPluginTransform(plugin, code, id)
    expect(buildResult).toBeUndefined()
  })
})
