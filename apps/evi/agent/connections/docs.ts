import { defineMcpClientConnection } from 'eve/connections'

export default defineMcpClientConnection({
  url: 'https://www.evlog.dev/mcp',
  description:
    'The published evlog documentation, the authority on what evlog does today: API surface, wide events, structured errors, sampling, redaction, the CLI, framework integrations, drain adapters, and extension points. `list-pages` returns every page with its title, path and description; `get-page` returns one page\'s full markdown plus the canonical URL to cite. Use it for any question about how evlog behaves or how to configure it. It does not cover unreleased work, source-level implementation detail, or anything specific to a user\'s own project.',
  tools: {
    allow: [
      'list-pages',
      'get-page'
    ]
  },
})
