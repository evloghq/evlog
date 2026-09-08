import { exec as execCallback } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { parseLintReport, scanCommand, shellQuote } from './scan'

describe('shellQuote', () => {
  it('survives the characters that end an argument', () => {
    expect(shellQuote('a\'b')).toBe(`'a'\\''b'`)
    expect(shellQuote('a; rm -rf /')).toBe(`'a; rm -rf /'`)
    expect(shellQuote('$(whoami)')).toBe(`'$(whoami)'`)
  })
})

describe('scanCommand', () => {
  it('uses distinct staging files for concurrent reviewers in a shared sandbox', () => {
    const first = scanCommand({ text: 'First page.' })
    const second = scanCommand({ text: 'Second page.' })
    expect(first.command).not.toBe(second.command)
  })

  it('scans concurrent passages independently and removes their temporary files', async () => {
    const root = resolve(import.meta.dirname, '../../../../..')
    const plans = ['First', 'Second'].map(title => scanCommand({ text: `---\ntitle: ${title}\n---\n\nRead the event.\n` }))
    await Promise.all(plans.map(plan => writeFile(plan.passage!.path, plan.passage!.content)))
    const results = await Promise.all(plans.map(plan => promisify(execCallback)(plan.command.replace('/workspace/repo', shellQuote(root)))))

    expect(results.map(result => JSON.parse(result.stdout).pages[0].frontmatter.title)).toEqual(['First', 'Second'])
    for (const plan of plans) {
      await expect(readFile(plan.passage!.path)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  }, 10_000)

  it('scans a file in the checkout at the surface it lives on', () => {
    const { command, passage } = scanCommand({ path: 'apps/docs/content/2.learn/a.md', as: 'blog' })

    expect(command).toContain(`'apps/docs/content/2.learn/a.md' --json`)
    expect(command).not.toContain('--as')
    expect(passage).toBeUndefined()
  })

  it('carries the surface for input that lives nowhere', () => {
    expect(scanCommand({ url: 'https://getpino.io/', as: 'reference' }).command)
      .toContain(`--url 'https://getpino.io/' --as 'reference' --json`)
    expect(scanCommand({ text: 'A draft.' }).command).toContain(`--as 'docs'`)
  })

  it('stages a passage in a file rather than in the command', () => {
    const { command, passage } = scanCommand({ text: 'It\'s `powerful` $(and) \'quoted\'.' })

    expect(passage?.content).toBe('It\'s `powerful` $(and) \'quoted\'.')
    expect(command).toContain(`--stdin --as 'docs' --json < ${passage?.path}`)
    expect(command).toContain(`trap 'rm -f ${passage?.path}' EXIT`)
    expect(command).not.toContain('powerful')
  })
})

describe('parseLintReport', () => {
  it('accepts the scanner JSON and rejects anything else', () => {
    expect(parseLintReport('{"baseline": {"p50": 1}, "pages": [{"path": "a.md"}]}'))
      .toEqual({ baseline: { p50: 1 }, pages: [{ path: 'a.md' }] })
    expect(parseLintReport('{"pages": "not-a-list"}')).toBeNull()
    expect(parseLintReport('warming up...')).toBeNull()
  })
})
