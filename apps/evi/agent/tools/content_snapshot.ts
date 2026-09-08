import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { capturePage, pagePathSchema } from '../lib/content/handoff'

export default defineTool({
  description: 'Capture a page identity (path, SHA-256 digest and source commit) for content_review or content_rewrite. Forward it unchanged; content_load verifies it against the shared workspace before reading the page.',
  inputSchema: z.object({ path: pagePathSchema }),
  async execute({ path }, ctx) {
    return capturePage(await ctx.getSandbox(), path)
  },
})
