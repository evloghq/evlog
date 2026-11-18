import { defineAgent } from 'eve'
import { mockModel } from 'eve/evals'

// "refund <order>" calls the refund tool once, then answers from its result.
export default defineAgent({
  model: mockModel({
    modelId: 'refund-script',
    provider: 'fixture',
    respond: ({ lastUserMessage, toolResults }) => {
      const order = /refund (\S+)/.exec(lastUserMessage ?? '')?.[1]
      if (!order) return 'Hello'
      if (toolResults.length === 0) return { toolCalls: [{ name: 'issue_refund', input: { order } }] }
      return `Refund result: ${JSON.stringify(toolResults[0]?.output)}`
    },
  }),
})
