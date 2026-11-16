import { EvlogError } from 'evlog'
import { useLogger } from 'evlog/eve'
import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import { eviErrors, refusal, type ToolRefusal } from '../lib/errors'
import { repositoryToken } from '../lib/github/credentials'
import { pushBrokerPolicy, validatePushBranch } from '../lib/github/push'
import { collectBranchCommits, pushSignedCommits, remoteBranchHead } from '../lib/github/signed-push'
import { cloneUrl, homeRepository, parseRepository, type Repository, repositorySlug } from '../lib/repo'
import { isVercelEnvironment } from '../lib/sandbox-backend'
import { canAccessAdminTools } from '../lib/trust'
import { checkoutDir, REPO_DIR, runOutput } from '../lib/workspace'
import { environment } from '../sandbox'

// Maintainer and schedule-app turns ship code; nothing else pushes.
export default defineDynamic((ctx) => {
  if (!canAccessAdminTools(ctx.session.auth.current)) return null
  const home = repositorySlug(homeRepository())
  return {
    git__push: defineTool({
      description: `Push a local branch to GitHub: to ${home} from ${REPO_DIR}, or to the repository named in \`repository\` from its clone at /workspace/<owner>/<repo>. The branch must already exist locally with the work committed and the checks run; main and master are refused. Each new commit is recreated on GitHub so that GitHub signs it, then the local branch is moved onto those commits: same files and messages, new shas. That push takes regular files only: merge commits, symlinks, submodules and executable bits are refused, and so is a branch on GitHub that the local one does not build on. The credential never enters the sandbox. After a successful push, open the pull request with github__createPullRequest.`,
      inputSchema: z.object({
        branch: z.string().min(1).describe('Branch name to push, e.g. fix/pipeline-flush'),
        repository: z.string().optional().describe(`owner/repo to push to; defaults to ${home}`),
      }),
      async execute(input, toolCtx) {
        const log = useLogger(toolCtx)
        const refuse = (refused: ToolRefusal) => {
          log.set({ git: { branch: input.branch, pushed: false, reason: refused.code } })
          return refused
        }
        if (!canAccessAdminTools(toolCtx.session.auth.current)) {
          return refuse(refusal(eviErrors.TOOL_NOT_AVAILABLE({ tool: 'git__push', message: 'Only maintainer and schedule-app sessions may push.' })))
        }
        const reason = validatePushBranch(input.branch)
        if (reason) return refuse(refusal(eviErrors.GIT_PUSH_REFUSED({ message: reason })))
        let repository: Repository
        if (input.repository === undefined) {
          repository = homeRepository()
        } else {
          const parsed = parseRepository(input.repository)
          if (parsed === null) return refuse(refusal(eviErrors.INPUT_REFUSED({ message: `"${input.repository}" is not an owner/repo slug.` })))
          repository = parsed
        }
        if (!isVercelEnvironment(environment)) {
          return refuse(refusal(eviErrors.TOOL_NOT_AVAILABLE({ tool: 'git__push', message: 'git__push needs the Vercel Sandbox firewall to broker the GitHub token, and this sandbox is local Docker. Run it on a deployment.' })))
        }
        const token = await repositoryToken(repository)
        if (token === null) return refuse(refusal(eviErrors.GITHUB_NOT_INSTALLED({ owner: repository.owner, repository: repositorySlug(repository) })))
        const dir = checkoutDir(repository)
        const sandbox = await toolCtx.getSandbox(environment)
        let sha: string
        let localHead: string
        let commits: number
        try {
          const remoteHead = await remoteBranchHead(token, repository, input.branch)
          const branch = await collectBranchCommits(sandbox, dir, input.branch, remoteHead)
          sha = await pushSignedCommits(token, repository, input.branch, branch)
          localHead = branch.head
          commits = branch.commits.length
        } catch (error) {
          if (!EvlogError.isEvlogError(error) || error.code === undefined) throw error
          return refuse(refusal(error))
        }
        await sandbox.setNetworkPolicy(pushBrokerPolicy(token))
        try {
          // The URL is spelled out, never `origin`: remote config inside the
          // sandbox is model-writable and must not redirect the brokered credential.
          // update-ref takes the head the commits were read from, so a commit added since stays.
          const align = await sandbox.run({
            command: `git -C ${dir} fetch ${cloneUrl(repository)} 'refs/heads/${input.branch}' && test "$(git -C ${dir} rev-parse FETCH_HEAD^{tree})" = "$(git -C ${dir} rev-parse '${input.branch}^{tree}')" && git -C ${dir} update-ref 'refs/heads/${input.branch}' ${sha} ${localHead}`,
          })
          if (align.exitCode !== 0) {
            const refused = refusal(eviErrors.GIT_COMMAND_FAILED({ command: 'fetch', exitCode: align.exitCode, message: `Pushed ${input.branch} to ${sha}, but the local branch could not be moved onto it, or its files differ: ${runOutput(align)}` }))
            log.set({ git: { branch: input.branch, pushed: true, sha, commits, reason: refused.code } })
            return refused
          }
        } finally {
          await sandbox.setNetworkPolicy('allow-all')
        }
        log.set({ git: { branch: input.branch, pushed: true, sha, commits } })
        return { success: true as const, branch: input.branch, sha, repository: repositorySlug(repository) }
      },
    }),
  }
})
