import type { SessionAuthContext } from 'eve/context'
import { useLogger } from 'evlog/eve'
import type { DynamicResolveContext } from 'eve/tools'
import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import { githubCredentials } from '../lib/github/credentials'
import { isValidRefName, mintInstallationToken, pushBrokerPolicy, validatePushBranch } from '../lib/github/push'
import { cloneUrl, homeRepository, parseRepository, repositorySlug } from '../lib/repo'
import { isMaintainer, isScheduleAppAuth } from '../lib/trust'
import { checkoutDir, REPO_DIR, runOutput } from '../lib/workspace'

/** Maintainer and schedule-app turns ship code; nothing else reaches git over the network. */
function canShip(auth: SessionAuthContext | null): boolean {
  return isMaintainer(auth) || isScheduleAppAuth(auth)
}

const NOT_ALLOWED = 'Only maintainer and schedule-app sessions may use git over the network.'

// Executes stay inline in the resolver (docs/notes.md).
const resolveGitTools = (_event: unknown, ctx: DynamicResolveContext) => {
  if (!canShip(ctx.session.auth.current)) return null
  const home = repositorySlug(homeRepository())
  return {
    git__checkout: defineTool({
      description: `Clone a repository the GitHub App is installed on into the sandbox, at /workspace/<owner>/<repo>, to read or change it there. ${home} is already checked out at ${REPO_DIR} and never needs this. Pass \`ref\` to land on a branch or commit instead of the default branch. The credential is brokered at the sandbox firewall and never enters the sandbox.`,
      inputSchema: z.object({
        repository: z.string().min(1).describe('owner/repo to clone'),
        ref: z.string().optional().describe('Branch or commit to check out'),
      }),
      async execute(input, toolCtx) {
        if (!canShip(toolCtx.session.auth.current)) return { success: false as const, error: NOT_ALLOWED }
        const log = useLogger(toolCtx)
        const repository = parseRepository(input.repository)
        if (repository === null) return { success: false as const, error: `"${input.repository}" is not an owner/repo slug.` }
        if (input.ref !== undefined && !isValidRefName(input.ref)) return { success: false as const, error: `"${input.ref}" is not a valid ref.` }
        const slug = repositorySlug(repository)
        const dir = checkoutDir(repository)
        const sandbox = await toolCtx.getSandbox()
        const token = await mintInstallationToken(githubCredentials)
        await sandbox.setNetworkPolicy(pushBrokerPolicy(token))
        try {
          const clone = await sandbox.run({ command: `test -d ${dir}/.git || git clone --depth 50 ${cloneUrl(repository)} ${dir}` })
          if (clone.exitCode !== 0) {
            log.set({ git: { checkout: { repository: slug, done: false, reason: `exit_${clone.exitCode}` } } })
            return { success: false as const, error: `git clone exited ${clone.exitCode}: ${runOutput(clone)}` }
          }
          if (input.ref !== undefined) {
            const checkout = await sandbox.run({ command: `git -C ${dir} fetch --depth 50 origin '${input.ref}' && git -C ${dir} checkout --detach FETCH_HEAD` })
            if (checkout.exitCode !== 0) {
              log.set({ git: { checkout: { repository: slug, done: false, reason: `exit_${checkout.exitCode}` } } })
              return { success: false as const, error: `git checkout exited ${checkout.exitCode}: ${runOutput(checkout)}` }
            }
          }
          const head = await sandbox.run({ command: `git -C ${dir} rev-parse HEAD` })
          const sha = String(head.stdout).trim()
          log.set({ git: { checkout: { repository: slug, done: true, sha } } })
          return { success: true as const, repository: slug, path: dir, sha }
        } finally {
          await sandbox.setNetworkPolicy('allow-all')
        }
      },
    }),
    git__push: defineTool({
      description: `Push a local branch to GitHub: to ${home} from ${REPO_DIR}, or to the repository named in \`repository\` from its git__checkout directory. The branch must already exist locally with the work committed and the checks run; main and master are refused. The credential is brokered at the sandbox firewall and never enters the sandbox. After a successful push, open the pull request with github__createPullRequest.`,
      inputSchema: z.object({
        branch: z.string().min(1).describe('Branch name to push, e.g. fix/pipeline-flush'),
        repository: z.string().optional().describe(`owner/repo to push to; defaults to ${home}`),
      }),
      async execute(input, toolCtx) {
        if (!canShip(toolCtx.session.auth.current)) return { success: false as const, error: NOT_ALLOWED }
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
        const dir = checkoutDir(repository)
        const sandbox = await toolCtx.getSandbox()
        const token = await mintInstallationToken(githubCredentials)
        await sandbox.setNetworkPolicy(pushBrokerPolicy(token))
        try {
          // The URL is spelled out, never `origin`: remote config inside the
          // sandbox is model-writable and must not redirect the brokered credential.
          const push = await sandbox.run({
            command: `git -C ${dir} push ${cloneUrl(repository)} 'refs/heads/${input.branch}:refs/heads/${input.branch}'`,
          })
          if (push.exitCode !== 0) {
            log.set({ git: { branch: input.branch, pushed: false, reason: `exit_${push.exitCode}` } })
            return { success: false as const, error: `git push exited ${push.exitCode}: ${runOutput(push)}` }
          }
          const head = await sandbox.run({ command: `git -C ${dir} rev-parse '${input.branch}'` })
          const sha = String(head.stdout).trim()
          log.set({ git: { branch: input.branch, pushed: true, sha } })
          return { success: true as const, branch: input.branch, sha, repository: repositorySlug(repository) }
        } finally {
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
    'session.started': resolveGitTools,
    'turn.started': resolveGitTools,
  },
})
