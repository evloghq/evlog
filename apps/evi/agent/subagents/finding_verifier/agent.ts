import { defineAgent } from 'eve'
import { gatewayRouting, sessionTags } from '../../lib/gateway'
import { MODEL } from '../../lib/model'

export default defineAgent({
  model: MODEL,
  reasoning: 'xhigh',
  tool: false,
  modelOptions: {
    providerOptions: { gateway: { ...gatewayRouting(), tags: sessionTags('simplification', 'finding_verifier') } },
  },
  description: 'Adversarially verify simplification candidates from other reviewers. Searches the current checkout for callers, tests, constraints, counterexamples, duplicates, and prior decisions, then classifies each candidate as confirmed, rejected, or an open question and selects the safe delivery path.',
})
