import { describe, expect, it } from 'vitest'
import type { LogLevel } from '../../src/types'
import { defined } from '../helpers/defined'
import { callConfigResolved, createParseTransformContext, getPluginHook, runPluginTransform } from '../helpers/vite'
import { createStripPlugin } from '../../src/vite/strip'

async function stripTransform(code: string, levels: LogLevel[], id = 'src/app.ts') {
  const plugin = createStripPlugin(levels)
  return await runPluginTransform(plugin, code, id, { config: { command: 'build' } })
}

describe('vite strip plugin', () => {
  it('removes log.debug() expression statements', async () => {
    const code = `log.debug('cache', 'hit')\nconst x = 1`
    const result = defined(await stripTransform(code, ['debug']), 'strip result')
    expect(result.code).not.toContain('log.debug')
    expect(result.code).toContain('const x = 1')
  })

  it('replaces log.debug() in assignment with void 0', async () => {
    const code = `const x = log.debug('test', 'msg')`
    const result = defined(await stripTransform(code, ['debug']), 'strip result')
    expect(result.code).toContain('void 0')
    expect(result.code).not.toContain('log.debug')
  })

  it('does not strip levels not in the list', async () => {
    const code = `log.info('app', 'started')\nlog.debug('cache', 'miss')`
    const result = defined(await stripTransform(code, ['debug']), 'strip result')
    expect(result.code).toContain('log.info')
    expect(result.code).not.toContain('log.debug')
  })

  it('strips multiple levels', async () => {
    const code = `log.debug('a', 'b')\nlog.info('c', 'd')\nlog.warn('e', 'f')`
    const result = defined(await stripTransform(code, ['debug', 'info']), 'strip result')
    expect(result.code).not.toContain('log.debug')
    expect(result.code).not.toContain('log.info')
    expect(result.code).toContain('log.warn')
  })

  it('returns undefined when no matching calls found', async () => {
    const code = `log.info('app', 'started')\nconst x = 1`
    const result = await stripTransform(code, ['debug'])
    expect(result).toBeUndefined()
  })

  it('skips node_modules files', async () => {
    const code = `log.debug('test', 'msg')`
    const result = await stripTransform(code, ['debug'], 'node_modules/lib/index.js')
    expect(result).toBeUndefined()
  })

  it('skips virtual modules', async () => {
    const code = `log.debug('test', 'msg')`
    const result = await stripTransform(code, ['debug'], '\0virtual:something')
    expect(result).toBeUndefined()
  })

  it('handles empty levels array', () => {
    const plugin = createStripPlugin([])
    expect(plugin.transform).toBeUndefined()
  })

  it('preserves surrounding code', async () => {
    const code = `const a = 1\nlog.debug('x', 'y')\nconst b = 2`
    const result = defined(await stripTransform(code, ['debug']), 'strip result')
    expect(result.code).toContain('const a = 1')
    expect(result.code).toContain('const b = 2')
    expect(result.code).not.toContain('log.debug')
  })

  it('generates sourcemap', async () => {
    const code = `log.debug('test', 'msg')\nconst x = 1`
    const result = defined(await stripTransform(code, ['debug']), 'strip result')
    expect(result.map).toBeTruthy()
  })

  it('does not strip in dev mode', async () => {
    const plugin = createStripPlugin(['debug'])
    await callConfigResolved(plugin, { command: 'serve' })
    const handler = getPluginHook<(code: string, id: string) => unknown>(plugin, 'transform')
    const code = `log.debug('test', 'msg')\nconst x = 1`
    const result = handler.call(createParseTransformContext() as never, code, 'src/app.ts')
    expect(result).toBeUndefined()
  })

  it('replaces log.debug() in ternary with void 0', async () => {
    const code = `const x = cond ? log.debug('a') : 'fallback'`
    const result = defined(await stripTransform(code, ['debug']), 'strip result')
    expect(result.code).toContain('void 0')
    expect(result.code).not.toContain('log.debug')
    expect(result.code).toContain('\'fallback\'')
  })

  it('replaces log.debug() in comma expression with void 0', async () => {
    const code = `const x = (log.debug('a'), 42)`
    const result = defined(await stripTransform(code, ['debug']), 'strip result')
    expect(result.code).toContain('void 0')
    expect(result.code).toContain('42')
    expect(result.code).not.toContain('log.debug')
  })

  it('replaces log.debug() in return statement with void 0', async () => {
    const code = `function foo() { return log.debug('x') }`
    const result = defined(await stripTransform(code, ['debug']), 'strip result')
    expect(result.code).toContain('return void 0')
    expect(result.code).not.toContain('log.debug')
  })

  it('replaces log.debug() in arrow function body with void 0', async () => {
    const code = `const fn = () => log.debug('x')`
    const result = defined(await stripTransform(code, ['debug']), 'strip result')
    expect(result.code).toContain('void 0')
    expect(result.code).not.toContain('log.debug')
  })

  it('replaces log.debug() as function argument with void 0', async () => {
    const code = `foo(log.debug('x'))`
    const result = defined(await stripTransform(code, ['debug']), 'strip result')
    expect(result.code).toContain('foo(void 0)')
    expect(result.code).not.toContain('log.debug')
  })

  it('replaces log.debug() in braceless if body with empty statement', async () => {
    const code = `if (cond) log.debug('x')\nconst y = 1`
    const result = defined(await stripTransform(code, ['debug']), 'strip result')
    expect(result.code).toContain('if (cond) ;')
    expect(result.code).toContain('const y = 1')
    expect(result.code).not.toContain('log.debug')
  })

  it('replaces log.debug() in braceless while body with empty statement', async () => {
    const code = `while (running) log.debug('tick')`
    const result = defined(await stripTransform(code, ['debug']), 'strip result')
    expect(result.code).toContain('while (running) ;')
    expect(result.code).not.toContain('log.debug')
  })
})
