import type { AxiomConfig } from 'evlog/axiom'
import { createClient } from 'some-axiom-client'

const token = 'abc'
export const client = createClient({ token })
export const config: Partial<AxiomConfig> = { apiKey: token, dataset: 'axiom-logs' }
