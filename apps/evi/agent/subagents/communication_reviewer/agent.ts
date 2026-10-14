import { defineAgent } from 'eve'
import { gatewayRouting, sessionTags } from '../../lib/gateway'
import { MODEL } from '../../lib/model'

export default defineAgent({
  model: MODEL,
  reasoning: 'xhigh',
  tool: false,
  modelOptions: {
    providerOptions: { gateway: { ...gatewayRouting(), tags: sessionTags('simplification', 'communication_reviewer') } },
  },
  description: 'Inspect Evi\'s bounded communication cohort: instructions, skills, evals, issue replies, review comments, and PR bodies supplied by the parent. Finds ambiguity, repeated conclusions, internal detail without user action, overlong commentary, and unsupported polish without rewriting artifacts.',
})
