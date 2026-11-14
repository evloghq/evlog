import { defineParentSandbox } from 'eve/sandbox'
import { disableTool } from 'eve/tools'
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
  it('inherits the parent workspace instead of cloning main', () => {
    const markers = Object.getOwnPropertySymbols(definition)
    for (const marker of Object.getOwnPropertySymbols(defineParentSandbox())) {
      expect(markers).toContain(marker)
    }
  })
})

it('keeps shell execution and file writes out of both content agents', () => {
  for (const tool of [reviewerShell, reviewerWrite, rewriterShell, rewriterWrite]) {
    expect(tool).toEqual(disableTool())
  }
})
