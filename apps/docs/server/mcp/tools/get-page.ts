import { z } from 'zod'
import { getAgentDocument } from '#agent-discovery'

/* Overrides Docus's `get-page` (same file name, so the app layer wins in
   @nuxtjs/mcp-toolkit). Docus's descriptions use example paths from its own
   starter site, which evlog does not have, and an agent copies the example
   path it is given. Every path here is a real evlog page.
   The handler is Docus's own: `test/mcp-tools.test.ts` fails if Docus stops
   shipping the tool this file replaces. */
export default defineMcpTool({
  description: `Retrieves the full markdown of one evlog documentation page.

WHEN TO USE: you know the exact path of the page. Common cases:
- "How do I install evlog?" → /start/installation
- "What is a wide event?" → /learn/wide-events
- "How do I add evlog to Nuxt?" → /integrate/frameworks/nuxt
- You found a path with list-pages and want the content

WHEN NOT TO USE: you do not know the path yet. Call list-pages first.

WORKFLOW: returns title, description, the full markdown, and the canonical URL. Paths have no locale prefix and no trailing .md.`,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    path: z.string().describe('The page path from list-pages, e.g. /start/installation or /learn/wide-events'),
  },
  inputExamples: [
    { path: '/start/installation' },
    { path: '/integrate/frameworks/nuxt' },
  ],
  cache: '1h',
  handler: async ({ path }) => {
    if (path.endsWith('.navigation') || path.includes('/.navigation/')) {
      throw createError({ statusCode: 404, message: 'Page not found' })
    }

    // The same bytes `/raw/<path>.md` serves, resolved in-process
    const document = await getAgentDocument(useEvent(), path)

    if (!document) {
      throw createError({ statusCode: 404, message: 'Page not found' })
    }

    if ('redirect' in document) {
      throw createError({ statusCode: 404, message: `${path} is a section, try ${document.redirect}` })
    }

    return {
      title: document.title,
      path,
      description: document.description,
      content: document.markdown,
      url: document.canonicalUrl,
    }
  },
})
