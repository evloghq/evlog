import { defineAgent } from 'eve'
import { mockModel } from 'eve/evals'

export default defineAgent({
  description: 'Looks into an order before a refund.',
  model: mockModel({ modelId: 'researcher-script', provider: 'fixture', respond: () => 'RESEARCH-OUTPUT-MARKER' }),
})
