import { defineTool } from 'eve/tools'
import { loadPage, pageSnapshotSchema } from '../../../lib/content/handoff'

export default defineTool({
  description: 'Verify the transferred page digest and check out its exact source commit. Review the returned text, which may differ from the file on disk. A missing revision or digest mismatch blocks review. Does not write the page.',
  inputSchema: pageSnapshotSchema,
  async execute(snapshot, ctx) {
    return loadPage(await ctx.getSandbox(), snapshot)
  },
})
