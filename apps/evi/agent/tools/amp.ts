import { useLogger } from 'evlog/eve'
import type { SessionAuthContext } from 'eve/context'
import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import {
  AMP_LAUNCH_PROGRESS_KEY,
  AMP_ROUTES,
  ampApiKey,
  ampApiKeyProblem,
  ampBindings,
  ampProgressUpdate,
  ampThreadTitle,
  buildAmpPrompt,
  digestAmpProgress,
  parseAmpThreadList,
  rememberAmpBinding,
  resolveStoredAmpThread,
  runAmpContinue,
  runAmpLaunch,
  runAmpList,
  runAmpMarkdown,
  runAmpSearch,
  type AmpBinding,
} from '../lib/amp'
import { eviErrors, refusal, type ToolRefusal } from '../lib/errors'
import { homeRepository, parseRepository, repositorySlug } from '../lib/repo'
import { isMaintainer } from '../lib/trust'

const threadLocator = {
  threadId: z.string().trim().min(1).optional().describe('Amp thread id (T-…) or https://ampcode.com/threads/T-… URL. Omit to use the mapped thread for this issue or session.'),
  issue: z.string().trim().min(1).optional().describe('Linear issue id (EVL-123) or GitHub issue number used to find the mapped Amp thread.'),
}

export default defineDynamic((ctx) => {
  if (!isMaintainer(ctx.session.auth.current) || ampApiKey() === null) return null
  return {
    amp__execute: defineTool({
      description: 'Start a coding task on Amp (ampcode.com) on Hugo\'s Amp subscription. Use it for multi-file changes, refactors, or work that needs tests, when the Linear issue has the amp label, or when asked to use Amp. Returns as soon as the orb thread exists. Then post the thread URL, sleep, and poll amp__status. If a thread is already mapped for this issue or session, call amp__continue instead. Do not use it for questions, single-file edits, reviews, or housekeeping. Never merge. If it refuses because Amp is unavailable, do the work yourself.',
      inputSchema: z.object({
        brief: z.string().trim().min(1).describe('The scoped coding task Amp should carry out, including acceptance criteria.'),
        route: z.enum(AMP_ROUTES).describe('Why this is Amp\'s job: the Linear amp label, an explicit ask, more than two files, tests, or a refactor.'),
        repository: z.string().optional().describe('owner/repo Amp should open against. Defaults to the home repository.'),
        branch: z.string().trim().min(1).optional().describe('Base branch Amp should start from. Defaults to main.'),
        issue: z.string().trim().min(1).optional().describe('Linear issue id (EVL-123) or GitHub issue number, when the task has one.'),
        paths: z.array(z.string().trim().min(1)).optional().describe('Paths Amp should prefer. Omit to let the brief name them.'),
      }),
      async execute(input, toolCtx) {
        const log = useLogger(toolCtx)
        const gated = gateAmp('amp__execute', toolCtx)
        if (!gated.ok) {
          log.set({ amp: { ok: false, action: 'execute', route: input.route, reason: gated.reason } })
          return gated.refusal
        }
        const parsedRepo = parseOptionalRepository(input.repository)
        if (!parsedRepo.ok) {
          log.set({ amp: { ok: false, action: 'execute', route: input.route, reason: 'evi.INPUT_REFUSED' } })
          return parsedRepo.refusal
        }
        const project = repositorySlug(parsedRepo.repository)
        const { binding: existingBinding, cliMissing: existingCliMissing } = await loadBinding({
          issue: input.issue,
          sessionId: toolCtx.session.id,
          apiKey: gated.key,
          signal: toolCtx.abortSignal,
          repository: project,
        })
        if (existingCliMissing) {
          log.set({ amp: { ok: false, action: 'execute', route: input.route, project, reason: 'evi.AMP_CLI_MISSING' } })
          return refusal(eviErrors.AMP_CLI_MISSING())
        }
        if (existingBinding) {
          storeBinding(existingBinding)
          log.set({ amp: { ok: true, action: 'execute', route: input.route, project, threadId: existingBinding.threadId, reused: true } })
          return {
            success: true as const,
            reused: true as const,
            threadId: existingBinding.threadId,
            threadUrl: existingBinding.threadUrl,
            message: 'An Amp thread is already mapped for this issue or session. Call amp__continue with a follow-up instead of starting a new thread.',
          }
        }
        const run = await runAmpLaunch({
          prompt: buildAmpPrompt({
            brief: input.brief,
            repository: project,
            branch: input.branch,
            issue: input.issue,
            paths: input.paths,
          }),
          project,
          title: ampThreadTitle(input.brief, input.issue),
          apiKey: gated.key,
          signal: toolCtx.abortSignal,
        })
        const outcome = { action: 'execute' as const, route: input.route, project, threadId: run.threadId }
        if (run.cliMissing) {
          log.set({ amp: { ok: false, ...outcome, reason: 'evi.AMP_CLI_MISSING' } })
          return { ...refusal(eviErrors.AMP_CLI_MISSING()), threadId: run.threadId, threadUrl: run.threadUrl }
        }
        if (run.threadId === null || run.threadUrl === null) {
          log.set({ amp: { ok: false, ...outcome, reason: 'evi.AMP_EXECUTE_FAILED' } })
          return refusal(eviErrors.AMP_EXECUTE_FAILED({ message: 'Amp did not return a thread URL.' }))
        }
        storeBinding({
          threadId: run.threadId,
          threadUrl: run.threadUrl,
          issue: input.issue ?? null,
          sessionId: toolCtx.session.id,
          repository: project,
          progressKey: AMP_LAUNCH_PROGRESS_KEY,
        })
        log.set({ amp: { ok: true, ...outcome } })
        return {
          success: true as const,
          running: true as const,
          threadId: run.threadId,
          threadUrl: run.threadUrl,
        }
      },
    }),

    amp__status: defineTool({
      description: 'Check an Amp thread Evi started. Pass threadId or the Linear/GitHub issue. Returns status, the pull request URL when Amp opened one, and update: a one-line status to post to the originating channel, or null when nothing changed (stay quiet).',
      inputSchema: z.object(threadLocator),
      async execute(input, toolCtx) {
        const log = useLogger(toolCtx)
        const gated = gateAmp('amp__status', toolCtx)
        if (!gated.ok) {
          log.set({ amp: { ok: false, action: 'status', reason: gated.reason } })
          return gated.refusal
        }
        const loaded = await loadBinding({
          threadId: input.threadId,
          issue: input.issue,
          sessionId: toolCtx.session.id,
          apiKey: gated.key,
          signal: toolCtx.abortSignal,
        })
        if (loaded.cliMissing) {
          log.set({ amp: { ok: false, action: 'status', reason: 'evi.AMP_CLI_MISSING' } })
          return refusal(eviErrors.AMP_CLI_MISSING())
        }
        const { binding } = loaded
        if (!binding) {
          log.set({ amp: { ok: false, action: 'status', reason: 'evi.AMP_THREAD_NOT_FOUND' } })
          return refusal(eviErrors.AMP_THREAD_NOT_FOUND())
        }
        const [listedRun, markdownRun] = await Promise.all([
          runAmpList({ apiKey: gated.key, signal: toolCtx.abortSignal }),
          runAmpMarkdown({ threadId: binding.threadId, apiKey: gated.key, signal: toolCtx.abortSignal }),
        ])
        if (listedRun.cliMissing || markdownRun.cliMissing) {
          log.set({ amp: { ok: false, action: 'status', threadId: binding.threadId, reason: 'evi.AMP_CLI_MISSING' } })
          return { ...refusal(eviErrors.AMP_CLI_MISSING()), threadId: binding.threadId, threadUrl: binding.threadUrl }
        }
        const listed = parseAmpThreadList(listedRun.stdout).find(thread => thread.id === binding.threadId) ?? null
        const progress = digestAmpProgress({ markdown: markdownRun.stdout, listed })
        const update = ampProgressUpdate(progress, binding.progressKey, binding.threadId)
        storeBinding({ ...binding, progressKey: progress.key })
        log.set({ amp: { ok: true, action: 'status', threadId: binding.threadId, status: progress.status } })
        return {
          success: true as const,
          threadId: binding.threadId,
          threadUrl: binding.threadUrl,
          status: progress.status,
          prUrl: progress.prUrl,
          files: progress.files,
          excerpt: progress.excerpt,
          update,
        }
      },
    }),

    amp__continue: defineTool({
      description: 'Send a follow-up to an existing Amp thread (review comments, a failing check). Pass threadId or the issue. Do not start a new thread with amp__execute.',
      inputSchema: z.object({
        brief: z.string().trim().min(1).describe('The follow-up Amp should act on.'),
        ...threadLocator,
      }),
      async execute(input, toolCtx) {
        const log = useLogger(toolCtx)
        const gated = gateAmp('amp__continue', toolCtx)
        if (!gated.ok) {
          log.set({ amp: { ok: false, action: 'continue', reason: gated.reason } })
          return gated.refusal
        }
        const loaded = await loadBinding({
          threadId: input.threadId,
          issue: input.issue,
          sessionId: toolCtx.session.id,
          apiKey: gated.key,
          signal: toolCtx.abortSignal,
        })
        if (loaded.cliMissing) {
          log.set({ amp: { ok: false, action: 'continue', reason: 'evi.AMP_CLI_MISSING' } })
          return refusal(eviErrors.AMP_CLI_MISSING())
        }
        const { binding } = loaded
        if (!binding) {
          log.set({ amp: { ok: false, action: 'continue', reason: 'evi.AMP_THREAD_NOT_FOUND' } })
          return refusal(eviErrors.AMP_THREAD_NOT_FOUND())
        }
        const run = await runAmpContinue({
          threadId: binding.threadId,
          prompt: input.brief,
          apiKey: gated.key,
          signal: toolCtx.abortSignal,
        })
        if (run.cliMissing) {
          log.set({ amp: { ok: false, action: 'continue', threadId: binding.threadId, reason: 'evi.AMP_CLI_MISSING' } })
          return { ...refusal(eviErrors.AMP_CLI_MISSING()), threadId: binding.threadId, threadUrl: binding.threadUrl }
        }
        if (run.threadId === null || run.threadUrl === null) {
          log.set({ amp: { ok: false, action: 'continue', threadId: binding.threadId, reason: 'evi.AMP_EXECUTE_FAILED' } })
          return {
            ...refusal(eviErrors.AMP_EXECUTE_FAILED({ message: 'Amp did not accept the follow-up.' })),
            threadId: binding.threadId,
            threadUrl: binding.threadUrl,
          }
        }
        storeBinding({
          ...binding,
          threadId: run.threadId,
          threadUrl: run.threadUrl,
          progressKey: AMP_LAUNCH_PROGRESS_KEY,
        })
        log.set({ amp: { ok: true, action: 'continue', threadId: run.threadId } })
        return {
          success: true as const,
          running: true as const,
          threadId: run.threadId,
          threadUrl: run.threadUrl,
        }
      },
    }),
  }
})

function gateAmp(tool: string, toolCtx: { session: { auth: { current: SessionAuthContext | null } } }):
  | { ok: true, key: string }
  | { ok: false, refusal: ToolRefusal, reason: string } {
  if (!isMaintainer(toolCtx.session.auth.current)) {
    return { ok: false, refusal: refusal(eviErrors.TOOL_NOT_AVAILABLE({ tool })), reason: 'evi.TOOL_NOT_AVAILABLE' }
  }
  const key = ampApiKey()
  const keyProblem = ampApiKeyProblem(key)
  if (keyProblem === 'missing' || key === null) {
    return { ok: false, refusal: refusal(eviErrors.AMP_API_KEY_MISSING()), reason: 'evi.AMP_API_KEY_MISSING' }
  }
  if (keyProblem === 'session-token') {
    return { ok: false, refusal: refusal(eviErrors.AMP_API_KEY_INVALID()), reason: 'evi.AMP_API_KEY_INVALID' }
  }
  return { ok: true, key }
}

function parseOptionalRepository(value: string | undefined):
  | { ok: true, repository: ReturnType<typeof homeRepository> }
  | { ok: false, refusal: ToolRefusal } {
  if (value === undefined) return { ok: true, repository: homeRepository() }
  const parsed = parseRepository(value)
  if (parsed === null) {
    return { ok: false, refusal: refusal(eviErrors.INPUT_REFUSED({ message: `"${value}" is not an owner/repo slug.` })) }
  }
  return { ok: true, repository: parsed }
}

function storeBinding(binding: AmpBinding) {
  ampBindings.update(current => rememberAmpBinding(current, binding))
}

async function loadBinding(input: {
  readonly threadId?: string
  readonly issue?: string
  readonly sessionId: string
  readonly apiKey: string
  readonly signal?: AbortSignal
  readonly repository?: string
}): Promise<{ binding: AmpBinding | null, cliMissing: boolean }> {
  const query = {
    threadId: input.threadId,
    issue: input.issue,
    sessionId: input.threadId === undefined && input.issue === undefined ? input.sessionId : undefined,
  }
  const stored = resolveStoredAmpThread({
    bindings: ampBindings.get(),
    listed: [],
    query,
    sessionId: input.sessionId,
    repository: input.repository,
  })
  if (stored) return { binding: stored, cliMissing: false }
  if (!input.issue) return { binding: null, cliMissing: false }
  const search = await runAmpSearch({ query: input.issue, apiKey: input.apiKey, signal: input.signal })
  if (search.cliMissing) return { binding: null, cliMissing: true }
  return {
    binding: resolveStoredAmpThread({
      bindings: ampBindings.get(),
      listed: parseAmpThreadList(search.stdout),
      query,
      sessionId: input.sessionId,
      repository: input.repository,
    }),
    cliMissing: false,
  }
}
