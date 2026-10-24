import { listAgentPages } from '#agent-discovery'

/* Overrides Docus's `list-pages` for the reason given in `get-page.ts`.
   evlog ships one locale, so Docus's `locale` filter has nothing to filter
   and is left out. `test/mcp-tools.test.ts` fails if Docus stops shipping
   the tool this file replaces. */
export default defineMcpTool({
  description: `Lists every evlog documentation page with its title, path, description, and URL.

WHEN TO USE: you need to find the page for a topic and do not know its path. Common cases:
- "Which frameworks does evlog support?" → pages under /integrate/frameworks/
- "Where are the drains for Axiom or Sentry?" → pages under /integrate/adapters/
- "How does evlog compare with pino?" → /compare/pino
- You want the shape of the docs before answering

WHEN NOT TO USE: you already know the path, e.g. /start/installation. Call get-page directly.

WORKFLOW: pick the relevant paths from this list, then call get-page on each one you need.

OUTPUT: one entry per page:
- title: page name
- path: exact path for get-page
- description: one-line summary
- url: full URL`,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  cache: '1h',
  handler: async () => {
    const pages = await listAgentPages(useEvent())

    // The landing page is not documentation
    return pages
      .filter(page => page.route !== '/')
      .map(page => ({
        title: page.title,
        path: page.route,
        description: page.description,
        url: page.url,
      }))
  },
})
