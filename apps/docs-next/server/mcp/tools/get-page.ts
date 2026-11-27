import { z } from 'zod'
import { withLeadingSlash } from 'ufo'
import { useEvent } from 'nitropack/runtime'
import { getAgentDocument } from '#agent-discovery'

export default defineMcpTool({
  description:
    'Read a documentation page as markdown. Pass the page path from list-pages, e.g. /getting-started/installation. Pass sections to keep only the named `##` headings of a long page.',
  inputSchema: {
    path: z.string().describe('Page path, e.g. /getting-started/installation'),
    sections: z.array(z.string()).optional().describe('Titles of the `##` sections to keep, e.g. ["Setup"]'),
  },
  handler: async ({ path, sections }) => {
    // The same document `/raw/<path>.md` serves, resolved in-process.
    const document = await getAgentDocument(useEvent(), withLeadingSlash(path), { sections })
    if (!document) {
      return {
        content: [{ type: 'text', text: `Page not found: ${path}. Use list-pages to see available paths.` }],
        isError: true,
      }
    }
    if ('redirect' in document) {
      return {
        content: [{ type: 'text', text: `${path} is a section, not a page. Read ${document.redirect} instead.` }],
        isError: true,
      }
    }

    return {
      content: [{ type: 'text', text: document.markdown }],
    }
  },
})
