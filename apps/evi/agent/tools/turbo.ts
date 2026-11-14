import { getVercelOidcToken } from '@vercel/oidc'
import { EvlogError } from 'evlog'
import { useLogger } from 'evlog/eve'
import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import { eviErrors, refusal } from '../lib/errors'
import { canAccessAdminTools } from '../lib/trust'
import { exchangeTurboToken, turboConfigCommand } from '../lib/turbo'
import { runOutput } from '../lib/workspace'

// The token only touches the remote cache, but never unattended: autonomous
// turns don't see this tool.
export default defineDynamic(ctx => {
  if (!canAccessAdminTools(ctx.session.auth.current)) return null
  return {
    turbo__enable_remote_cache: defineTool({
      description: 'Connect the sandbox checkout to the team\'s Turborepo Remote Cache for this session. Call it once before running the checks: turbo then reuses artifacts CI already built instead of running every task cold. The short-lived token is written to turbo\'s own config files, never into a command. Run the checks with TURBO_REMOTE_CACHE_READ_ONLY=true so the sandbox never writes to the shared cache.',
      inputSchema: z.object({}),
      async execute(_input, toolCtx) {
        if (!canAccessAdminTools(toolCtx.session.auth.current)) {
          return refusal(eviErrors.TOOL_NOT_AVAILABLE({ tool: 'turbo__enable_remote_cache' }))
        }
        const log = useLogger(toolCtx)
        const refuse = (error: EvlogError) => {
          const refused = refusal(error)
          log.set({ turbo: { remoteCache: false, reason: refused.code } })
          return refused
        }
        const teamSlug = process.env.TURBO_TEAM
        const teamId = process.env.VERCEL_TEAM_ID
        if (!teamSlug || !teamId) return refuse(eviErrors.TURBO_NOT_CONFIGURED())
        // Fetched per call: the env token is minted at boot and expires on a warm instance.
        let oidc: string
        try {
          oidc = await getVercelOidcToken()
        } catch (error) {
          return refuse(eviErrors.TURBO_NO_OIDC_TOKEN({
            message: `No Vercel OIDC token available: ${error instanceof Error ? error.message : String(error)}`,
          }))
        }
        let token: string
        try {
          token = await exchangeTurboToken(oidc, teamSlug)
        } catch (error) {
          return refuse(EvlogError.isEvlogError(error) ? error : eviErrors.TURBO_TOKEN_EXCHANGE_FAILED({ cause: error as Error }))
        }
        const sandbox = await toolCtx.getSandbox()
        const write = await sandbox.run({ command: turboConfigCommand(token, teamId, teamSlug) })
        if (write.exitCode !== 0) {
          return refuse(eviErrors.TURBO_CONFIG_WRITE_FAILED({ message: `Writing the turbo config failed: ${runOutput(write)}` }))
        }
        log.set({ turbo: { remoteCache: true } })
        return {
          success: true as const,
          team: teamSlug,
          note: 'Remote cache connected for this session (token is short-lived). Prefix check commands with TURBO_REMOTE_CACHE_READ_ONLY=true.',
        }
      },
    }),
  }
})
