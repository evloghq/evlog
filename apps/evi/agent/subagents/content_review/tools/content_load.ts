import { defineTool } from 'eve/tools'
import { loadPage, pageSnapshotSchema } from '../../../lib/content/handoff'

export default defineTool({
  description: 'Read a page from the shared parent workspace only if its digest and source commit still match the supplied snapshot. A mismatch blocks review. Returns the verified text and identity without changing files or Git state.',
  inputSchema: pageSnapshotSchema,
  async execute(snapshot, ctx) {
    return loadPage(await ctx.getSandbox(), snapshot)
  },
})
