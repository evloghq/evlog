import { z } from 'zod'

export default defineMcpTool({
  description:
    'Search the documentation. Returns matching sections with their page path and heading anchor.',
  inputSchema: {
    query: z.string().describe('Search terms, e.g. "github source" or "full text search"'),
  },
  handler: async ({ query }) => {
    const content = await getProdContent()
    const results = await searchDocSections(content, query)

    if (!results.length) {
      return {
        content: [{ type: 'text', text: `No results for "${query}". Try list-pages to browse all pages.` }],
      }
    }

    const text = results
      .map((section) => {
        const crumb = [...section.titles, section.title].join(' > ')
        const snippet = section.content.slice(0, 200)
        return `${section.id}\n${crumb}${snippet ? `\n${snippet}` : ''}`
      })
      .join('\n\n')

    return {
      content: [{ type: 'text', text }],
    }
  },
})
