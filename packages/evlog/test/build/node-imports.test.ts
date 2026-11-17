import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const distDir = resolve(import.meta.dirname, '../../dist')
const catalogDist = resolve(distDir, 'catalog.mjs')
const distExists = existsSync(catalogDist)

if (!distExists) {
  console.warn('[evlog test] Skipping dist node imports: dist/ not found. Run `pnpm --filter evlog run build` first.')
}

function readDist(relativePath: string): string {
  return readFileSync(resolve(distDir, relativePath), 'utf8')
}

function listDistFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix = '') => {
    for (const entry of readdirSync(dir)) {
      const rel = prefix ? `${prefix}/${entry}` : entry
      const abs = resolve(dir, entry)
      if (statSync(abs).isDirectory()) walk(abs, rel)
      else if (entry.endsWith('.mjs')) out.push(rel)
    }
  }
  walk(distDir)
  return out
}

function collectRelativeImports(entryPath: string): string[] {
  const seen = new Set<string>()
  const imports: string[] = []
  const importRe = /from\s+["'](\.[^"']+)["']/g

  const walk = (relativePath: string, fromDir = distDir) => {
    const abs = resolve(fromDir, relativePath)
    if (seen.has(abs)) return
    seen.add(abs)
    const source = readFileSync(abs, 'utf8')
    let match: RegExpExecArray | null
    const currentDir = dirname(abs)
    while ((match = importRe.exec(source))) {
      const next = match[1].replace(/^\.\//, '')
      imports.push(next)
      walk(next, currentDir)
    }
  }

  walk(entryPath)
  return imports
}

function assertNoNodeBuiltins(source: string, label: string): void {
  expect(source, label).not.toMatch(/import\s*\(\s*['"]node:(crypto|fs|path|module|diagnostics_channel)['"]/)
  expect(source, label).not.toMatch(/from\s+['"]node:(crypto|fs|path|module|diagnostics_channel)['"]/)
  expect(source, label).not.toContain('pretty-error-snippet.node')
}

describe.skipIf(!distExists)('dist node built-in imports (#387)', () => {
  it('audit graph does not import Node built-ins', () => {
    for (const chunk of ['audit.mjs', ...collectRelativeImports('audit.mjs')]) {
      assertNoNodeBuiltins(readDist(chunk), chunk)
    }
  })

  it('audit-action entry stays isomorphic', () => {
    assertNoNodeBuiltins(readDist('audit-action.mjs'), 'audit-action.mjs')
  })

  it('catalog entry stays lean and Node-free', () => {
    const source = readDist('catalog.mjs')
    assertNoNodeBuiltins(source, 'catalog.mjs')
    expect(source).toMatch(/from "\.\/audit-action\.mjs"/)

    const graph = collectRelativeImports('catalog.mjs')
    expect(graph).not.toContain('audit.mjs')
    expect(graph.some(path => /^audit-/.test(path) && !path.startsWith('audit-action'))).toBe(false)
  })

  it('index entry does not pull pretty-error-snippet.node', () => {
    assertNoNodeBuiltins(readDist('index.mjs'), 'index.mjs')
  })

  it('the diagnostics channel stays out of the index graph', () => {
    for (const chunk of collectRelativeImports('index.mjs')) {
      assertNoNodeBuiltins(readDist(chunk), chunk)
    }

    const nodeChunk = listDistFiles().find(file => /^diagnostics-channel\.node-/.test(file))
    expect(nodeChunk, 'expected a lazily-imported diagnostics-channel.node chunk').toBeDefined()
    expect(readDist(nodeChunk!)).toMatch(/from\s+["']node:diagnostics_channel["']/)
  })
})

describe.skipIf(!distExists)('dist pretty output', () => {
  it('prints an error logged right before a synchronous process.exit()', () => {
    const script = `
      import { createError, createLogger, initLogger } from ${JSON.stringify(pathToFileURL(resolve(distDir, 'index.mjs')).href)}
      initLogger({ pretty: true, env: { service: 'demo' } })
      const log = createLogger({ path: '/checkout' })
      log.error(createError({ message: 'Payment failed', why: 'Card declined' }))
      log.emit()
      process.exit(0)
    `
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development' } })
    expect(output).toContain('error:')
    expect(output).toContain('Payment failed')
    expect(output).toContain('/checkout')
  })
})
