import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import { applyRewrite, pageSnapshotSchema } from '../lib/content/handoff'
import { canAccessAdminTools } from '../lib/trust'

export default defineDynamic({
  events: {
    'turn.started': (_event, ctx) => {
      if (!canAccessAdminTools(ctx.session.auth.current)) return null
      return defineTool({
        description: 'Apply a returned content rewrite in the parent workspace. Requires the original snapshot and the full replacement text. Refuses if the parent page or source commit changed since review. Review the returned snapshot before shipping.',
        inputSchema: z.object({ snapshot: pageSnapshotSchema, text: z.string().max(200_000) }),
        async execute({ snapshot, text }, toolCtx) {
          if (!canAccessAdminTools(toolCtx.session.auth.current)) throw new Error('Only maintainer and schedule-app sessions may apply rewrites.')
          return applyRewrite(await toolCtx.getSandbox(), snapshot, text)
        },
      })
    },
  },
})
