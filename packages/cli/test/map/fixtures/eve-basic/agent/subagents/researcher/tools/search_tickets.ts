import { useLogger } from '@evlog/eve/logger'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

// The root agent's evlog mount does not reach a subagent's sessions.
export default defineTool({
  description: 'Search support tickets.',
  inputSchema: z.object({ query: z.string() }),
  execute({ query }) {
    useLogger().set({ search: { query } })
    return { tickets: [] }
  },
})
