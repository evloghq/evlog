import { createAxiomDrain } from 'evlog/axiom'

export const drain = createAxiomDrain({ token: 'old', apiKey: 'new', dataset: 'logs' })
