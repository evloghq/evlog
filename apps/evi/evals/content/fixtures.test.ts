import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('keeps the factual regression invisible to the prose scanner', () => {
  const root = resolve(import.meta.dirname, '../../../..')
  const text = readFileSync(resolve(import.meta.dirname, 'fixtures/polished-false.md'), 'utf8')
  const report = JSON.parse(execFileSync(process.execPath, ['scripts/content-lint/index.mjs', '--stdin', '--as', 'docs', '--json'], { cwd: root, input: text, encoding: 'utf8' }))

  expect(report.pages[0].score).toBe(100)
  expect(report.pages[0].findings).toEqual([])
  const pkg = JSON.parse(readFileSync(resolve(root, 'packages/evlog/package.json'), 'utf8'))
  expect(pkg.exports).toHaveProperty('./memory')
  expect(readFileSync(resolve(root, 'packages/evlog/src/index.ts'), 'utf8')).toContain('definePlugin')
}, 10_000)

it('executes the positive fixture example without rewriting its code', () => {
  const root = resolve(import.meta.dirname, '../../../..')
  const text = readFileSync(resolve(root, 'scripts/content-lint/fixtures/written.md'), 'utf8')
  const sample = /```js\n([\s\S]*?)\n```/.exec(text)?.[1]
  expect(sample).toBeDefined()
  expect(() => execFileSync(process.execPath, ['--input-type=module'], {
    cwd: resolve(root, 'packages/evlog'),
    input: sample,
    encoding: 'utf8',
  })).not.toThrow()
})
