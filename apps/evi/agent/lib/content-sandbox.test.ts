import type { SandboxParentValue } from 'eve/sandbox'
import { isDisabledToolSentinel } from 'eve/tools'
import { describe, expect, it } from 'vitest'
import reviewerSandbox from '../subagents/content_review/sandbox/sandbox'
import reviewerShell from '../subagents/content_review/tools/bash'
import reviewerWrite from '../subagents/content_review/tools/write_file'
import rewriterSandbox from '../subagents/content_rewrite/sandbox/sandbox'
import rewriterShell from '../subagents/content_rewrite/tools/bash'
import rewriterWrite from '../subagents/content_rewrite/tools/write_file'

describe.each([
  ['reviewer', reviewerSandbox],
  ['rewriter', rewriterSandbox],
] as const)('%s sandbox', (_name, definition) => {
  it('selects the parent workspace instead of cloning main', async () => {
    expect(typeof definition).toBe('function')
    const sandbox = {} as SandboxParentValue
    expect(await definition({ parent: { sandbox } })).toBe(sandbox)
  })

  it('refuses to start without a parent workspace', () => {
    expect(() => definition({ parent: null })).toThrow('parent')
  })
})

it('keeps shell execution and file writes out of both content agents', () => {
  for (const tool of [reviewerShell, reviewerWrite, rewriterShell, rewriterWrite]) {
    expect(isDisabledToolSentinel(tool)).toBe(true)
  }
})
