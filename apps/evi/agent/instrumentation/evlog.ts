import { evlogTraces } from '@evlog/eve/instrumentation'

/** Puts each turn's trace and `invoke_agent` span id on its wide event, so Agent Runs opens from a `requestId`. */
export default evlogTraces()
