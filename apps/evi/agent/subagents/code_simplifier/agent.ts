import { defineAgent } from 'eve'
import { gatewayRouting, sessionTags } from '../../lib/gateway'
import { MODEL } from '../../lib/model'

export default defineAgent({
  model: MODEL,
  reasoning: 'high',
  tool: false,
  modelOptions: {
    providerOptions: { gateway: { ...gatewayRouting(), tags: sessionTags('simplification', 'code_simplifier') } },
  },
  description: 'Inspect one bounded evlog code cohort for behavior-preserving reductions: dead paths, duplicated logic, unnecessary wrappers, speculative branches, needless defensive code, and comments that restate the implementation. Reports evidence and a smaller shape without editing files.',
})
