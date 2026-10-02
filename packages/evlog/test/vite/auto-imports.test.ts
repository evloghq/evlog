import { describe, expect, it } from 'vitest'
import { defined } from '../helpers/defined'
import { runPluginTransform } from '../helpers/vite'
import { createAutoImportsPlugin } from '../../src/vite/auto-imports'

async function autoImportTransform(code: string, id = 'src/app.ts', options = {}) {
  const plugin = createAutoImportsPlugin(options)
  return await runPluginTransform(plugin, code, id)
}

describe('vite auto-imports plugin', () => {
  it('adds import for log when log.info() is used', async () => {
    const code = `log.info('auth', 'User logged in')`
    const result = defined(await autoImportTransform(code), 'auto-import result')
    expect(result.code).toContain('import { log } from \'evlog\'')
  })

  it('adds import for log when log.error() is used', async () => {
    const code = `log.error({ action: 'payment', error: 'declined' })`
    const result = defined(await autoImportTransform(code), 'auto-import result')
    expect(result.code).toContain('import { log } from \'evlog\'')
  })

  it('adds import for createEvlogError when called', async () => {
    const code = `throw createEvlogError({ message: 'test', status: 400 })`
    const result = defined(await autoImportTransform(code), 'auto-import result')
    expect(result.code).toContain('import { createEvlogError } from \'evlog\'')
  })

  it('adds import for parseError when called', async () => {
    const code = `const err = parseError(caught)`
    const result = defined(await autoImportTransform(code), 'auto-import result')
    expect(result.code).toContain('import { parseError } from \'evlog\'')
  })

  it('does not add import if already imported from evlog', async () => {
    const code = `import { log } from 'evlog'\nlog.info('test', 'msg')`
    const result = await autoImportTransform(code)
    expect(result).toBeUndefined()
  })

  it('does not add import if already imported from #imports', async () => {
    const code = `import { log } from '#imports'\nlog.info('test', 'msg')`
    const result = await autoImportTransform(code)
    expect(result).toBeUndefined()
  })

  it('does not add import for locally declared log variable', async () => {
    const code = `const log = console\nlog.info('test')`
    const result = await autoImportTransform(code)
    expect(result).toBeUndefined()
  })

  it('does not add import for imported log from other library', async () => {
    const code = `import { log } from 'other-lib'\nlog.info('test')`
    const result = await autoImportTransform(code)
    expect(result).toBeUndefined()
  })

  it('skips node_modules files', async () => {
    const code = `log.info('test', 'msg')`
    const result = await autoImportTransform(code, 'node_modules/lib/index.js')
    expect(result).toBeUndefined()
  })

  it('returns undefined when no symbols are used', async () => {
    const code = `const x = 1 + 2`
    const result = await autoImportTransform(code)
    expect(result).toBeUndefined()
  })

  it('respects custom imports list', async () => {
    const code = `log.info('test', 'msg')\nthrow createEvlogError('error')`
    const result = defined(await autoImportTransform(code, 'src/app.ts', { imports: ['log'] }), 'auto-import result')
    expect(result.code).toContain('import { log } from \'evlog\'')
    expect(result.code).not.toContain('import { createEvlogError')
  })

  it('generates sourcemap', async () => {
    const code = `log.info('test', 'msg')`
    const result = defined(await autoImportTransform(code), 'auto-import result')
    expect(result.map).toBeTruthy()
  })

  it('adds import for setIdentity from evlog/client', async () => {
    const code = `setIdentity({ userId: '123' })`
    const result = defined(await autoImportTransform(code, 'src/app.ts', {
      imports: ['setIdentity'],
    }), 'auto-import result')
    expect(result.code).toContain('import { setIdentity } from \'evlog/client\'')
  })

  it('adds import for clearIdentity from evlog/client', async () => {
    const code = `clearIdentity()`
    const result = defined(await autoImportTransform(code, 'src/app.ts', {
      imports: ['clearIdentity'],
    }), 'auto-import result')
    expect(result.code).toContain('import { clearIdentity } from \'evlog/client\'')
  })

  it('groups log and parseError in same evlog import', async () => {
    const code = `log.info('test', 'msg')\nconst e = parseError(err)`
    const result = defined(await autoImportTransform(code), 'auto-import result')
    expect(result.code).toContain('import { log, parseError } from \'evlog\'')
  })
})
