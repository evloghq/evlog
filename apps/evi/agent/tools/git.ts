import { ConnectorInstallationRequiredError, getToken } from '@vercel/connect'
import { EvlogError } from 'evlog'
import { useLogger } from '@evlog/eve/logger'
import { executeGitHubShell } from 'eve/extensions/git/sandbox'
import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import { eviErrors, refusal, type ToolRefusal } from '../lib/errors'
import { validatePushBranch } from '../lib/github/push'
import { pushSignedBranch, signedPushGitHub } from '../lib/github/signed-push'
import { homeRepository, parseRepository, type Repository, repositorySlug } from '../lib/repo'
import { isVercelEnvironment } from '../lib/sandbox-backend'
import { canAccessAdminTools } from '../lib/trust'
import { checkoutDir, REPO_DIR } from '../lib/workspace'
import { environment } from '../sandbox'

// Maintainer and schedule-app turns ship code; nothing else pushes.
export default defineDynamic((ctx) => {
  if (!canAccessAdminTools(ctx.session.auth.current)) return null
  const home = repositorySlug(homeRepository())
  return {
    git__push: defineTool({
      description: `Push a local branch to GitHub: to ${home} from ${REPO_DIR}, or to the repository named in \`repository\` from its clone at /workspace/<owner>/<repo>. The branch must already exist locally with the work committed and the checks run; main and master are refused. Each new commit is published through GitHub so that GitHub signs it, then the local branch is moved onto those commits: same files and messages, new shas. That push takes regular files only: merge commits, symlinks, submodules and executable bits are refused, and so is a branch on GitHub that the local one does not build on. The credential never enters the sandbox. After a successful push, open the pull request with github__createPullRequest.`,
      inputSchema: z.object({
        branch: z.string().min(1).describe('Branch name to push, e.g. fix/pipeline-flush'),
        repository: z.string().optional().describe(`owner/repo to push to; defaults to ${home}`),
      }),
      async execute(input, toolCtx) {
        const log = useLogger()
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
        const slug = repositorySlug(repository)
        const sandbox = await toolCtx.getSandbox(environment)
        const gh = (command: Parameters<typeof executeGitHubShell>[0]) => executeGitHubShell({ ...command, repository: slug }, signedPushGitHub(sandbox), {
          auth: toolCtx.session.auth.current,
          getConnectToken: getToken,
          getSandbox: () => toolCtx.getSandbox(environment),
          sessionId: toolCtx.session.id,
          abortSignal: toolCtx.abortSignal,
        })
        try {
          const { sha, commits } = await pushSignedBranch(sandbox, gh, { dir: checkoutDir(repository), repository, branch: input.branch })
          log.set({ git: { branch: input.branch, pushed: true, sha, commits } })
          return { success: true as const, branch: input.branch, sha, repository: slug }
        } catch (error) {
          if (error instanceof ConnectorInstallationRequiredError) {
            return refuse(refusal(eviErrors.GITHUB_NOT_INSTALLED({ owner: repository.owner, repository: slug })))
          }
          if (!EvlogError.isEvlogError(error) || error.code === undefined) throw error
          return refuse(refusal(error))
        }
      },
    }),
  }
})
