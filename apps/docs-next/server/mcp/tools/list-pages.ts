import { useEvent } from 'nitropack/runtime'
import { listAgentPages } from '#agent-discovery'

export default defineMcpTool({
  description:
    'List every page of the documentation with its path, title, and description. Use get-page to read a page.',
  handler: async () => {
    const pages = await listAgentPages(useEvent())

    const lines = pages.map(
      (page) =>
        `${page.route} — ${page.title ?? page.route}${page.description ? `: ${page.description}` : ''}${page.section ? ` (${page.section})` : ''}`
    )

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    }
  },
})
