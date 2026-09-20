import { useLogger } from 'evlog/eve'
import type { DynamicResolveContext } from 'eve/tools'
import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import { githubCredentials } from '../lib/github/credentials'
import { mintInstallationToken, pushBrokerPolicy, validatePushBranch } from '../lib/github/push'
import { cloneUrl, homeRepository, parseRepository, repositorySlug } from '../lib/repo'
import { isMaintainer, isScheduleAppAuth } from '../lib/trust'
import { REPO_DIR, runOutput } from '../lib/workspace'

// Maintainer and schedule-app turns only; the push is inert (feature
// branches only). Keep executes inline in the resolver (docs/notes.md).
const resolvePushTools = (_event: unknown, ctx: DynamicResolveContext) => {
  if (!isMaintainer(ctx.session.auth.current) && !isScheduleAppAuth(ctx.session.auth.current)) return null
  const home = repositorySlug(homeRepository())
  return {
    git__push: defineTool({
      description: `Push a local branch of the ${REPO_DIR} checkout to GitHub: to ${home}, or to the repository named in \`repository\` when the thread lives elsewhere. The branch must already exist locally with the work committed and the checks run; main and master are refused. The credential is brokered at the sandbox firewall and never enters the sandbox. After a successful push, open the pull request with github__createPullRequest.`,
      inputSchema: z.object({
        branch: z.string().min(1).describe('Branch name in /workspace/repo to push, e.g. fix/pipeline-flush'),
        repository: z.string().optional().describe(`owner/repo to push to; defaults to ${home}`),
      }),
      async execute(input, toolCtx) {
        if (!isMaintainer(toolCtx.session.auth.current) && !isScheduleAppAuth(toolCtx.session.auth.current)) {
          return { success: false as const, error: 'Only maintainer and schedule-app sessions may push.' }
        }
        const log = useLogger(toolCtx)
        const refusal = validatePushBranch(input.branch)
        if (refusal) {
          log.set({ git: { branch: input.branch, pushed: false, reason: 'refused' } })
          return { success: false as const, error: refusal }
        }
        const repository = input.repository === undefined ? homeRepository() : parseRepository(input.repository)
        if (repository === null) {
          log.set({ git: { branch: input.branch, pushed: false, reason: 'refused' } })
          return { success: false as const, error: `"${input.repository}" is not an owner/repo slug.` }
        }
        const sandbox = await toolCtx.getSandbox()
        const token = await mintInstallationToken(githubCredentials)
        await sandbox.setNetworkPolicy(pushBrokerPolicy(token))
        try {
          // The URL is spelled out, never `origin`: remote config inside the
          // sandbox is model-writable and must not redirect the brokered credential.
          const push = await sandbox.run({
            command: `git -C ${REPO_DIR} push ${cloneUrl(repository)} 'refs/heads/${input.branch}:refs/heads/${input.branch}'`,
          })
          if (push.exitCode !== 0) {
            log.set({ git: { branch: input.branch, pushed: false, reason: `exit_${push.exitCode}` } })
            return { success: false as const, error: `git push exited ${push.exitCode}: ${runOutput(push)}` }
          }
          const head = await sandbox.run({ command: `git -C ${REPO_DIR} rev-parse '${input.branch}'` })
          const sha = String(head.stdout).trim()
          log.set({ git: { branch: input.branch, pushed: true, sha } })
          return {
            success: true as const,
            branch: input.branch,
            sha,
            repository: repositorySlug(repository),
          }
        } finally {
          // Drop the brokered credential; the channel checkout re-brokers its own when it needs to fetch.
          await sandbox.setNetworkPolicy('allow-all')
        }
      },
    }),
  }
}

// Session scope alongside turn scope: eve rebinds only session-scoped resolvers
// when it replays a call parked in a process that is gone, and a push is the
// last thing a long run does. `execute` re-checks the caller, so the wider
// scope grants nothing the per-turn gate would refuse.
export default defineDynamic({
  events: {
    'session.started': resolvePushTools,
    'turn.started': resolvePushTools,
  },
})
