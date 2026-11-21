import { defineAgent } from 'eve'
import { mockModel } from 'eve/evals'

// "refund <order> [<order>...]" calls the refund tool once per order in one step, then answers from the first result;
// "logs <view> [where <clause>] [expect <environment>]" does the same with the evlog logs tool;
// "background <service> [<service>...]" loads a skill, starts a deploy task per service and a researcher task.
export default defineAgent({
  model: mockModel({
    modelId: 'refund-script',
    provider: 'fixture',
    respond: ({ lastUserMessage, toolResults }) => {
      const services = /^background (.+)/.exec(lastUserMessage ?? '')?.[1]?.split(' ')
      if (services) {
        if (toolResults.length > 0) return 'Background work done'
        return {
          toolCalls: [
            { name: 'eve__skill', input: { name: 'triage' } },
            ...services.map(service => ({ name: 'deploy', input: { service } })),
            { name: 'researcher', input: { message: 'Look into order 9001' } },
          ],
        }
      }
      const [, view, where, environment] = /^logs (\w+)(?: where (\S+))?(?: expect (\S+))?/.exec(lastUserMessage ?? '') ?? []
      if (view) {
        const read = toolResults.find(result => result.name === 'evlog__logs')
        if (!read) return { toolCalls: [{ name: 'evlog__logs', input: { view, ...(where && { where: [where] }), ...(environment && { expect: { environment } }) } }] }
        return `Logs: ${JSON.stringify(read.output)}`
      }
      const orders = /refund (.+)/.exec(lastUserMessage ?? '')?.[1]?.split(' ')
      if (!orders) return 'Hello'
      if (toolResults.length === 0) return { toolCalls: orders.map(order => ({ name: 'issue_refund', input: { order } })) }
      return `Refund result: ${JSON.stringify(toolResults[0]?.output)}`
    },
  }),
})
