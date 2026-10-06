import type { LanguageModel } from 'ai'
import type { SessionAuthContext } from 'eve/context'
import { MODEL } from '../model'
import { isPullRequestReview } from '../trust'
import { reviewState } from './review-state'

type ApprovalModel = Extract<LanguageModel, { specificationVersion: 'v4' }>

function approvalResult({ prompt }: Parameters<ApprovalModel['doGenerate']>[0]) {
  const attempted = prompt.some(message => message.role === 'tool'
      && message.content.some(part => part.type === 'tool-result' && part.toolName === 'pr_review__prepare'))
  return {
    content: attempted ? [] : [{ type: 'tool-call' as const, toolCallId: 'pr-review-prepare', toolName: 'pr_review__prepare', input: '{}' }],
    finishReason: { unified: attempted ? 'stop' as const : 'tool-calls' as const, raw: undefined },
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
    warnings: [],
  }
}

const approvalModel: ApprovalModel = {
  specificationVersion: 'v4',
  provider: 'evi',
  modelId: 'pr-review-approval',
  supportedUrls: {},
  doGenerate: options => Promise.resolve(approvalResult(options)),
  doStream(options) {
    const result = approvalResult(options)
    return Promise.resolve({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          for (const part of result.content) controller.enqueue(part)
          controller.enqueue({ type: 'finish', finishReason: result.finishReason, usage: result.usage })
          controller.close()
        },
      }),
    })
  },
}

/** Emit only the native approval call until the approved checkout succeeds. */
export function reviewStepModel(auth: SessionAuthContext | null) {
  return isPullRequestReview(auth) && !reviewState.get().prepared ? approvalModel : MODEL
}
