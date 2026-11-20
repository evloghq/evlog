import evlog from '@evlog/eve'
import config from '../../evlog.config'

export default evlog({
  ...config,
  keep: (ctx) => {
    const { context } = ctx
    const tools = (context.gen_ai as { tools?: Array<{ success: boolean }> } | undefined)?.tools
    if (tools?.some(tool => !tool.success)) {
      ctx.shouldKeep = true
    }
    const refund = context.refund as { amount?: number } | undefined
    if ((refund?.amount ?? 0) > 100) {
      ctx.shouldKeep = true
    }
  },
})
