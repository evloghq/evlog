import { useLogger } from 'evlog/eve'
import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import { uploadSandboxImage } from '../lib/blob'
import { eviErrors, refusal } from '../lib/errors'
import { canAccessAdminTools } from '../lib/trust'

// Public URLs the instant they exist: autonomous turns never see this tool.
export default defineDynamic(ctx => {
  if (!canAccessAdminTools(ctx.session.auth.current)) return null
  return {
    blob__upload_image: defineTool({
      description: 'Upload an image file from the sandbox to the evlog Vercel Blob store and return its public URL. Use it to share screenshots (before/after comparisons, visual evidence) in pull requests and conversations. png/jpg/webp/gif, 8 MB max. The URL is public: upload only captures of evlog surfaces.',
      inputSchema: z.object({
        path: z.string().min(1).describe('Sandbox path of the image, e.g. /workspace/screenshots/after.png'),
      }),
      async execute(input, toolCtx) {
        if (!canAccessAdminTools(toolCtx.session.auth.current)) {
          return refusal(eviErrors.TOOL_NOT_AVAILABLE({ tool: 'blob__upload_image' }))
        }
        const log = useLogger(toolCtx)
        const uploaded = await uploadSandboxImage(await toolCtx.getSandbox(), input.path)
        if ('error' in uploaded) {
          const refused = refusal(eviErrors.BLOB_UPLOAD_FAILED({ message: uploaded.error }))
          log.set({ blob: { uploaded: false, reason: refused.code } })
          return refused
        }
        log.set({ blob: { uploaded: true, bytes: uploaded.bytes } })
        return { success: true as const, ...uploaded }
      },
    }),
  }
})
