import { connect } from '@vercel/connect/eve'
import { defineOpenAPIConnection } from 'eve/connections'
import { adminGatedAuth } from '../lib/connect'
import { decideEnvVarWrite } from '../lib/vercel-env'

const { EVI_VERCEL_API_CONNECTOR } = process.env

// Hand-authored spec (docs/connections/openapi.mdx recommends inline objects
// for small hand-picked contracts): one POST, /v10/projects/{idOrName}/env,
// the Vercel REST env-var upsert. Everything else about the Vercel write API
// stays out of the surface: no deploys, no purchases, no deletes, no traces.
const SPEC = {
  openapi: '3.0.3',
  info: { title: 'Vercel project environment variables', version: '1.0.0' },
  paths: {
    '/v10/projects/{idOrName}/env': {
      post: {
        operationId: 'createProjectEnv',
        summary: 'Create or update a project environment variable (upsert).',
        parameters: [
          { name: 'idOrName', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'upsert', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['key', 'value', 'type', 'target'],
                properties: {
                  key: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
                  value: { type: 'string', maxLength: 1024 },
                  // Non-secret config only: the type enum is closed on purpose.
                  type: { type: 'string', enum: ['plain'] },
                  target: {
                    type: 'array',
                    minItems: 1,
                    items: { type: 'string', enum: ['production', 'preview', 'development'] },
                  },
                  comment: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'The created or updated environment variable.' } },
      },
    },
  },
} as const

/**
 * Approval policy for the write surface: allowlisted non-secret keys on
 * allowlisted projects run on their own, everything else pauses for a human
 * (an Approve card in Slack), and secret-shaped keys are refused outright.
 * The connection's auth gate already keeps non-admin sessions out; this is
 * the second boundary, and both run the same pure decision.
 */
function envVarApproval({ toolInput }: { toolInput?: unknown }) {
  // Same shape the generated operation exposes: a path param plus the
  // model-authored body. Guard the access: toolInput can be undefined.
  const input = toolInput as { idOrName?: string, body?: { key?: string } } | undefined
  return decideEnvVarWrite({ projectId: input?.idOrName ?? '', key: input?.body?.key ?? '' })
}

// `vercel/api` is the Vercel-managed connector UID for the management API;
// override with EVI_VERCEL_API_CONNECTOR if the team's connector is
// provisioned under a different UID. App principal: the agent itself, the
// same credential the read-only vercel connection already rides.
export default defineOpenAPIConnection({
  spec: SPEC,
  baseUrl: 'https://api.vercel.com',
  description: [
    '**Vercel env-var write connection (admin only, human-approved):** the only write surface on Vercel.',
    '',
    '- One tool, `vercel-write__createProjectEnv`: upserts one non-secret environment variable on one project (`type` is fixed to `plain`, values capped at 1024 characters, targets limited to `production`, `preview`, `development`).',
    '- `upsert` is supplied by the app; do not pass it.',
    '- Allowlisted non-secret agent-config keys on writable projects run on their own. Anything else pauses for human approval: when a write is needed, call this tool and wait for the Approve card instead of explaining CLI commands or asking the user to paste values.',
    '- Secret-shaped keys (`*TOKEN`, `*SECRET`, `*KEY`, `DATABASE_URL`, ...) are refused outright, by policy, even with an approval.',
    '- Writes land on the project the next deployment reads, so a redeploy is required for the change to apply; say so when reporting a successful write.',
    '- Deploys, purchases, deletes, and traces have no tool on this connection and on the read-only `vercel` connection: never look for a workaround.',
  ].join(String.fromCharCode(10)),
  auth: adminGatedAuth(() => connect({ connector: EVI_VERCEL_API_CONNECTOR ?? 'vercel/api', principalType: 'app' })),
  approval: envVarApproval,
  toolCall: {
    providedArguments: {
      upsert: 'true',
    },
  },
})
