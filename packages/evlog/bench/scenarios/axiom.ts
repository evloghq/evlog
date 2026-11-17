import { initLogger, log } from 'evlog'
import { createAxiomDrain } from 'evlog/axiom'

initLogger({ env: { service: 'my-app' }, drain: createAxiomDrain() })

log.info({ action: 'checkout' })
