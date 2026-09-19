import { getToken } from '@vercel/connect'
import { useLogger } from 'evlog/eve'
import { defineDynamic, defineTool } from 'eve/tools'
import { z } from 'zod'
import { canAccessAdminTools } from '../lib/trust'
import { decideEnvVarWrite, SEQUENTIAL_APPROVAL_RULE } from '../lib/vercel-env'

const { EVI_VERCEL_API_CONNECTOR, VERCEL_TEAM_ID } = process.env

// The `vercel/mcp` connector is what the read-only connection already rides,
// so the write path uses the same installation; the REST upsert rides its
// token. Override with EVI_VERCEL_API_CONNECTOR if a dedicated Vercel API
// connector is ever provisioned. App principal, so the agent itself holds
// the credential.
function connectToken(): Promise<string> {
  return getToken(EVI_VERCEL_API_CONNECTOR ?? 'vercel/mcp', { subject: { type: 'app' } })
}

// Writes never exist for autonomous turns (first responder, schedules): the
// dynamic gate returns no tools, and the approval policy plus the re-check in
// execute are the two boundaries behind it. All three run the same pure
// decision in lib/vercel-env.ts, so bypassing one opens nothing.
export default defineDynamic({
  events: {
    'turn.started': (_event, ctx) => {
      if (!canAccessAdminTools(ctx.session.auth.current)) return null
      return {
        set_vercel_env: defineTool({
          description: [
            'Create or update one non-secret environment variable on one Vercel project, via the REST upsert (POST /v10/projects/{idOrName}/env?upsert=true). The type is always `plain`: secret-shaped keys (`*TOKEN`, `*SECRET`, `*KEY`, `DATABASE_URL`, `*DSN`, ...) are refused outright, by policy, even with an approval. Allowlisted non-secret agent-config keys on writable projects run on their own; anything else pauses for a human approval card. A write lands on the project the next deployment reads, so a redeploy is required for the change to apply. This is the only write surface on Vercel: never look for a workaround around it.',
            SEQUENTIAL_APPROVAL_RULE,
          ].join(' '),
          inputSchema: z.object({
            projectId: z.string().min(1).describe('The Vercel project id, like `prj_...`. Find ids with the read-only `vercel__list_projects`.'),
            key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Environment variable names are letters, digits, and underscores.')
              .describe('The environment variable name, like `EVI_VERCEL_MCP_ROUTE`.'),
            value: z.string().min(1).max(1024).describe('The plain (non-secret) value.'),
            target: z.array(z.enum(['production', 'preview', 'development'])).min(1)
              .describe('The environments the variable applies to, usually `["production", "preview", "development"]`.'),
          }),
          approval: ({ toolInput }) => {
            // Same shape the schema defines above. Guard the access:
            // toolInput can be undefined.
            const input = toolInput as { projectId?: string, key?: string } | undefined
            return decideEnvVarWrite({ projectId: input?.projectId ?? '', key: input?.key ?? '' })
          },
          async execute(input, toolCtx) {
            // Defense against a bypass of the approval gate, not a second
            // approval: reaching execute means either the policy auto-
            // approved or a human answered the card, so only a denial
            // (secret-shaped key) still blocks here.
            const decision = decideEnvVarWrite({ projectId: input.projectId, key: input.key })
            if (decision !== 'not-applicable' && decision !== 'user-approval' && decision.type === 'denied') {
              return { success: false as const, error: decision.reason }
            }
            const log = useLogger(toolCtx)
            const path = VERCEL_TEAM_ID
              ? `/v10/projects/${ encodeURIComponent(input.projectId) }/env?upsert=true&teamId=${ encodeURIComponent(VERCEL_TEAM_ID) }`
              : `/v10/projects/${ encodeURIComponent(input.projectId) }/env?upsert=true`
            let token: string
            try {
              token = await connectToken()
            } catch (error) {
              log.set({ vercel: { env: false, reason: 'no_connect_token' } })
              return { success: false as const, error: `No Vercel Connect token available: ${error instanceof Error ? error.message : String(error)}` }
            }
            // The value lives in the request body only: it never reaches the
            // log metadata or the tool result.
            const response = await fetch(`https://api.vercel.com${ path }`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: input.key, value: input.value, type: 'plain', target: input.target }),
              signal: AbortSignal.timeout(10_000),
            })
            if (!response.ok) {
              log.set({ vercel: { env: false, reason: `api_${response.status}` } })
              // Error bodies never echo variable values; still capped, and
              // the value itself never enters the error path.
              const body = (await response.text()).slice(0, 400)
              return { success: false as const, error: `The Vercel API returned ${response.status}: ${body}` }
            }
            log.set({ vercel: { env: true, key: input.key, project: input.projectId, target: input.target } })
            return {
              success: true as const,
              key: input.key,
              projectId: input.projectId,
              target: input.target,
              note: 'Upserted. The project reads the new value on its next deployment.',
            }
          },
        }),
      }
    },
  },
})
