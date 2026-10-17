import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import { prepareExternalReview, publishExternalReview, reviewApprovalResponse, reviewInputSchema, reviewScope } from '../lib/github/external-review'
import { isPullRequestReview } from '../lib/trust'

export default defineDynamic({
  events: {
    'turn.started': (_event, ctx) => {
      if (!isPullRequestReview(ctx.session.auth.current)) return null
      const scope = reviewScope(ctx.session.auth.current)
      return {
        pr_review__prepare: defineTool({
          description: 'Request maintainer approval to review this PR, then check out its exact head. A denied request runs nothing. Call before inspecting or executing contributor code.',
          label: { start: () => `Review PR #${scope.number} at ${scope.sha.slice(0, 12)} (tests and suggestions only)` },
          inputSchema: z.object({}),
          approval: { request: () => 'user-approval', response: reviewApprovalResponse },
          execute: (_input, toolCtx) => prepareExternalReview(toolCtx.session.auth.current, toolCtx),
        }),
        pr_review__publish: defineTool({
          description: 'Publish a COMMENT review with verified checks, examples, visual evidence and inline GitHub suggestions. Only the approved PR and commit are accepted. Never approve, merge or change a branch.',
          inputSchema: reviewInputSchema,
          execute: (input, toolCtx) => publishExternalReview(toolCtx.session.auth.current, input),
        }),
      }
    },
  },
})
