import { defineTool } from 'eve/tools'
import { z } from 'zod'

// No @evlog/eve mount in this member: nothing records its turns.
export default defineTool({
  description: 'Restart a service.',
  inputSchema: z.object({ service: z.string() }),
  execute({ service }) {
    return { restarted: service }
  },
})
