import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { capturePage, pagePathSchema } from '../lib/content/handoff'

export default defineTool({
  description: 'Capture the complete current page, its SHA-256 digest and source commit for content_review or content_rewrite. Forward the returned snapshot unchanged; declared subagents have separate filesystems.',
  inputSchema: z.object({ path: pagePathSchema }),
  async execute({ path }, ctx) {
    return capturePage(await ctx.getSandbox(), path)
  },
})
