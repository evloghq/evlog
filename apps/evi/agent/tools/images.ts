import { getToken } from '@vercel/connect'
import { useLogger } from 'evlog/eve'
import { defineDynamic, defineTool, toolOutput, toolOutputPart } from 'eve/tools'
import { z } from 'zod'
import { eviErrors, refusal } from '../lib/errors'
import { classifyImageUrl, fetchImage } from '../lib/images'
import { canAccessAdminTools } from '../lib/trust'

// Available in every session: screenshots in community bug reports are the
// main reason this tool exists. Only the Linear host needs a credential, and
// only admin sessions get it.
export default defineDynamic(() => {
  return {
    images__view: defineTool({
      description: 'Fetch an image referenced by URL and look at it: the pixels come back as visual content. Use it for image URLs in issue or PR bodies, comments, and Linear documents that are not already attached to the conversation. Supported hosts: GitHub attachments (github.com/user-attachments, *.githubusercontent.com) and Linear uploads (uploads.linear.app); anything else is refused. png/jpg/webp/gif, 2 MB max. When the fetch fails, report the returned reason instead of describing an image you have not seen.',
      inputSchema: z.object({
        url: z.string().min(1).describe('The image URL exactly as it appears in the markdown'),
      }),
      async execute(input, toolCtx) {
        const classified = classifyImageUrl(input.url)
        if ('error' in classified) return refusal(eviErrors.IMAGE_URL_REFUSED({ message: classified.error }))
        let authorization: string | undefined
        if (classified.host === 'linear') {
          if (!canAccessAdminTools(toolCtx.session.auth.current)) {
            return refusal(eviErrors.TOOL_NOT_AVAILABLE({ tool: 'images__view', message: 'Linear-hosted images are not available in this session.' }))
          }
          authorization = `Bearer ${await getToken('linear/evi', { subject: { type: 'app' } })}`
        }
        const log = useLogger(toolCtx)
        const fetched = await fetchImage(classified.url, { authorization })
        if ('error' in fetched) {
          const refused = refusal(eviErrors.IMAGE_FETCH_FAILED({ message: fetched.error }))
          log.set({ image: { host: classified.host, fetched: false, reason: refused.code } })
          return refused
        }
        log.set({ image: { host: classified.host, fetched: true, bytes: fetched.bytes, mediaType: fetched.mediaType } })
        return { success: true as const, url: input.url, ...fetched }
      },
      toModelOutput(output) {
        if (!output.success) return toolOutput.text(`Could not read the image: ${output.error}`)
        return toolOutput.content([
          toolOutputPart.text(`Image at ${output.url} (${output.mediaType}, ${output.bytes} bytes):`),
          toolOutputPart.file(output.base64, { mediaType: output.mediaType }),
        ])
      },
    }),
  }
})
