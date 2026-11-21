import { defineAgent } from 'eve'

export default defineAgent({
  description: 'Looks into an order before a refund.',
  model: 'anthropic/claude-haiku-4.5',
})
