import { createAxiomDrain } from 'evlog/axiom'
import { createBetterStackDrain } from 'evlog/better-stack'

const sourceToken = process.env.BETTER_STACK_API_KEY

export const drains = [
  createAxiomDrain({ apiKey: process.env.AXIOM_API_KEY, dataset: 'logs' }),
  createBetterStackDrain({ apiKey: sourceToken }),
]
