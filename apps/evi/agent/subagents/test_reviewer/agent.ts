import { defineAgent } from 'eve'
import { gatewayRouting, sessionTags } from '../../lib/gateway'
import { MODEL } from '../../lib/model'

export default defineAgent({
  model: MODEL,
  reasoning: 'high',
  tool: false,
  modelOptions: {
    providerOptions: { gateway: { ...gatewayRouting(), tags: sessionTags('simplification', 'test_reviewer') } },
  },
  description: 'Inspect one bounded evlog test cohort and its source for redundant, obsolete, or implementation-mirroring coverage. Reports removals or merges only when another cited test preserves the same contract and the candidate has no distinct failure mode, runtime boundary, or regression value. Never edits files.',
})
