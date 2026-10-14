import { defineAgent } from 'eve'
import { gatewayRouting, sessionTags } from '../../lib/gateway'
import { MODEL } from '../../lib/model'

export default defineAgent({
  model: MODEL,
  reasoning: 'xhigh',
  tool: false,
  modelOptions: {
    providerOptions: { gateway: { ...gatewayRouting(), tags: sessionTags('simplification', 'architecture_reviewer') } },
  },
  description: 'Inspect one bounded set of evlog package relationships for accidental complexity: duplicate authorities, leaky layers, abstractions that no longer earn their cost, inconsistent contracts, and workflows implemented at the wrong layer. Reports proposals and mechanical reductions without editing files.',
})
