import { useLogger } from '@evlog/eve/logger'
import { defineWorkflowTool } from 'eve/tools'
import { createError } from 'evlog'
import { z } from 'zod'

// Runs as a background task: each call returns a receipt.
export default defineWorkflowTool({
  description: 'Deploy a service in the background.',
  inputSchema: z.object({ service: z.string() }),
  async task({ service }) {
    'use workflow'
    useLogger().set({ deploy: { service } })
    if (service === 'frozen') {
      throw createError({ status: 409, message: 'Deploys are frozen', why: 'A release freeze is on', fix: 'Retry after the freeze' })
    }
    return { url: `https://${service}.example.invalid` }
  },
})
