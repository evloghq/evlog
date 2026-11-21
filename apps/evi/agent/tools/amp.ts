import { useLogger } from 'evlog/eve'
import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import {
  ampApiKey,
  ampApiKeyProblem,
  ampThreadTitle,
  ampThreadUrl,
  AMP_ROUTES,
  buildAmpPrompt,
  runAmpExecute,
} from '../lib/amp'
import { channelName } from '../lib/channel'
import { eviErrors, refusal } from '../lib/errors'
import { homeRepository, parseRepository, repositorySlug } from '../lib/repo'
import { isMaintainer } from '../lib/trust'

export default defineDynamic((ctx) => {
  if (!isMaintainer(ctx.session.auth.current) || ampApiKey() === null) return null
  return {
    amp__execute: defineTool({
      description: 'Delegate a coding task to Amp (ampcode.com) on Hugo\'s Amp subscription. Use it for multi-file changes, refactors, or work that needs tests, when the Linear issue has the amp label, or when asked to use Amp. Do not use it for questions, single-file edits, reviews, or housekeeping. After it returns, verify the result yourself (tests, before-after captures) and never merge. If it refuses because Amp is unavailable, do the work yourself.',
      inputSchema: z.object({
        brief: z.string().trim().min(1).describe('The scoped coding task Amp should carry out, including acceptance criteria.'),
        route: z.enum(AMP_ROUTES).describe('Why this is Amp\'s job: the Linear amp label, an explicit ask, more than two files, tests, or a refactor.'),
        repository: z.string().optional().describe('owner/repo Amp should open against. Defaults to the home repository.'),
        branch: z.string().trim().min(1).optional().describe('Base branch Amp should start from. Defaults to main.'),
        issue: z.string().trim().min(1).optional().describe('Linear issue id (EVL-123) or GitHub issue number, when the task has one.'),
        paths: z.array(z.string().trim().min(1)).optional().describe('Paths Amp should prefer. Omit to let the brief name them.'),
        requester: z.string().trim().min(1).max(80).optional().describe('GitHub login or display name of the person who asked, for the PR disclaimer. Defaults to "the maintainer".'),
      }),
      async execute(input, toolCtx) {
        const log = useLogger(toolCtx)
        if (!isMaintainer(toolCtx.session.auth.current)) {
          return refusal(eviErrors.TOOL_NOT_AVAILABLE({ tool: 'amp__execute' }))
        }
        const key = ampApiKey()
        const keyProblem = ampApiKeyProblem(key)
        if (keyProblem === 'missing' || key === null) {
          log.set({ amp: { ok: false, route: input.route, reason: 'evi.AMP_API_KEY_MISSING' } })
          return refusal(eviErrors.AMP_API_KEY_MISSING())
        }
        if (keyProblem === 'session-token') {
          log.set({ amp: { ok: false, route: input.route, reason: 'evi.AMP_API_KEY_INVALID' } })
          return refusal(eviErrors.AMP_API_KEY_INVALID())
        }
        let repository = homeRepository()
        if (input.repository !== undefined) {
          const parsed = parseRepository(input.repository)
          if (parsed === null) {
            log.set({ amp: { ok: false, route: input.route, reason: 'evi.INPUT_REFUSED' } })
            return refusal(eviErrors.INPUT_REFUSED({ message: `"${input.repository}" is not an owner/repo slug.` }))
          }
          repository = parsed
        }
        const project = repositorySlug(repository)
        const channel = channelName(toolCtx.channel.kind)
        const requester = input.requester ?? 'the maintainer'
        const prompt = buildAmpPrompt({
          brief: input.brief,
          repository: project,
          branch: input.branch,
          issue: input.issue,
          paths: input.paths,
          requester,
          channel,
        })
        const run = await runAmpExecute({
          prompt,
          project,
          title: ampThreadTitle(input.brief),
          apiKey: key,
          signal: toolCtx.abortSignal,
        })
        const threadId = run.state.threadId
        const threadUrl = ampThreadUrl(threadId)
        const outcome = { route: input.route, project, threadId, turns: run.state.turns }
        if (run.cliMissing) {
          log.set({ amp: { ok: false, ...outcome, reason: 'evi.AMP_CLI_MISSING' } })
          return { ...refusal(eviErrors.AMP_CLI_MISSING()), threadId, threadUrl }
        }
        if (run.aborted || (!run.state.finished && threadUrl !== null)) {
          log.set({ amp: { ok: false, ...outcome, reason: 'evi.AMP_EXECUTE_FAILED' } })
          return {
            ...refusal(eviErrors.AMP_EXECUTE_FAILED({
              message: 'Amp is still running in the orb. The local wait ended before a result arrived.',
            })),
            threadId,
            threadUrl,
          }
        }
        if (!run.state.finished || run.state.isError) {
          log.set({ amp: { ok: false, ...outcome, reason: 'evi.AMP_EXECUTE_FAILED' } })
          return {
            ...refusal(eviErrors.AMP_EXECUTE_FAILED({
              internal: run.state.error === null ? undefined : { error: run.state.error },
            })),
            threadId,
            threadUrl,
          }
        }
        log.set({ amp: { ok: true, ...outcome } })
        return {
          success: true as const,
          threadId,
          threadUrl,
          summary: run.state.summary,
          durationMs: run.state.durationMs,
          turns: run.state.turns,
        }
      },
    }),
  }
})
