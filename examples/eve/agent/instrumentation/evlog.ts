import { evlogTraces } from '@evlog/eve/instrumentation'

// Puts each turn's traceId and invoke_agent spanId on its wide event.
// Reads span ids only: it exports nothing and adds no sampling.
export default evlogTraces()
