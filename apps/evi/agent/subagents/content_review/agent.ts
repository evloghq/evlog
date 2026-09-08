import { defineAgent } from 'eve'
import { gatewayRouting, sessionTags } from '../../lib/gateway'
import { MODEL } from '../../lib/model'

export default defineAgent({
  model: MODEL,
  /** Judging a candidate against its twin is the hardest call in the pass. */
  reasoning: 'xhigh',
  modelOptions: {
    providerOptions: { gateway: { ...gatewayRouting(), tags: sessionTags('content') } },
  },
  description:
    'Requires the complete content_snapshot result; calls content_load to verify its digest and pin the source revision before reviewing the transferred text. '
    + 'Review one evlog content file (a docs page, the landing, a blog post, a package README, a skill, an AGENTS.md) against the write-evlog-content skill and the content-lint candidates. '
    + 'Judges each candidate against the legitimate twin the skill carries for it, verifies drift findings against the package source, answers the questions the scanner could not measure, and returns findings with verbatim excerpts, rule ids, and a verdict. '
    + 'Carries `content_scan`, so it can scan another file, a passage, or an external URL when the candidates it was handed are not enough. '
    + 'Reports only: it never rewrites and never writes a file.',
})
