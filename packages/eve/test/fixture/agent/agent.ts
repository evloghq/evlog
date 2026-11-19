import { defineAgent } from 'eve'
import { mockModel } from 'eve/evals'

// "refund <order>" calls the refund tool once, then answers from its result;
// "logs <view>" does the same with the evlog logs tool.
export default defineAgent({
  model: mockModel({
    modelId: 'refund-script',
    provider: 'fixture',
    respond: ({ lastUserMessage, toolResults }) => {
      const view = /^logs (\w+)/.exec(lastUserMessage ?? '')?.[1]
      if (view) {
        const read = toolResults.find(result => result.name === 'evlog__logs')
        if (!read) return { toolCalls: [{ name: 'evlog__logs', input: { view } }] }
        return `Logs: ${JSON.stringify(read.output)}`
      }
      const order = /refund (\S+)/.exec(lastUserMessage ?? '')?.[1]
      if (!order) return 'Hello'
      if (toolResults.length === 0) return { toolCalls: [{ name: 'issue_refund', input: { order } }] }
      return `Refund result: ${JSON.stringify(toolResults[0]?.output)}`
    },
  }),
})
