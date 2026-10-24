import { createAxiomDrain } from 'evlog/axiom'

export const drain = createAxiomDrain({
  token: process.env.AXIOM_TOKEN,
  dataset: 'logs',
})
export const fallback = process.env['BETTER_STACK_SOURCE_TOKEN']
