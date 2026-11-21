import { defineWorkflowTool } from 'eve/tools'
import { FatalError } from 'eve/workflow'
import { z } from 'zod'

// A `task` entry point: each call returns a receipt and runs as a background task.
export default defineWorkflowTool({
  description: 'Deploy a service in the background.',
  inputSchema: z.object({ service: z.string() }),
  async task({ service }) {
    'use workflow'
    return await deploy(service)
  },
})

// eslint-disable-next-line require-await -- eve's bundler refuses a "use step" function that is not async
async function deploy(service: string) {
  'use step'
  // FatalError fails the step at once instead of after the step retries.
  if (service === 'broken') throw new FatalError('Deploy failed')
  return { contact: 'ops@clearbill.dev', url: `https://${service}.example.invalid`, note: 'TASK-OUTPUT-MARKER' }
}
