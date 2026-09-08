import { defineAgent } from 'eve'
import { gatewayRouting, sessionTags } from '../../lib/gateway'
import { MODEL } from '../../lib/model'

export default defineAgent({
  model: MODEL,
  reasoning: 'high',
  modelOptions: {
    providerOptions: { gateway: { ...gatewayRouting(), tags: sessionTags('content') } },
  },
  description:
    'Apply a content review to one evlog page. Takes the review findings and edits only what they name, in the evlog voice, preserving MDC structure, frontmatter, and every link target. '
    + 'Loads the caller snapshot with content_load and verifies factual changes against the pinned source. Returns the complete replacement text and input digest for the parent to apply; its filesystem is separate. '
    + 'Never edits a page it was not given findings for, and never invents findings of its own.',
})
