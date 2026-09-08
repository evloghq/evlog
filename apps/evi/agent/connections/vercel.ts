import { defineMcpClientConnection } from 'eve/connections'
import { adminOnlyAppConnection } from '../lib/connect'

const { VERCEL_TEAM_ID } = process.env

const ALLOWED_TOOLS: string[] = [
  'search_vercel_documentation',
  'search_vercel_endpoints',
  'call_vercel_endpoint',
  'get_runtime_logs',
  'get_runtime_errors',
  'list_agent_run_projects',
  'list_agent_runs',
]

// The description must stay non-empty at build time, when VERCEL_TEAM_ID is
// absent; it is only interpolated here, never gated on.
const TEAM_ID = VERCEL_TEAM_ID ? `teamId=${VERCEL_TEAM_ID}` : 'the teamId from VERCEL_TEAM_ID'

const VERCEL_MCP_INSTRUCTIONS = [
  '**Vercel MCP connection (vercel__*, admin only): read-only, use judiciously.**',
  '',
  '- Most of the platform is reached through two tools, not one per resource: `vercel__search_vercel_endpoints` returns the endpoint id and its input schema, then `vercel__call_vercel_endpoint` runs it. Search for the operation you want rather than guessing a path or a version prefix.',
  `- The connection is scoped to the evlog team (${ TEAM_ID }) but NOT to a single project: evlog runs several Vercel projects, so pass the team id, and the project id when the endpoint takes one. The ones this agent reaches for: \`GET /v7/deployments\` (filter by \`projectId\`, \`state\`, \`sha\`), \`GET /v3/deployments/{idOrUrl}/events\` for build logs, and \`GET /v1/query/web-analytics/visits/count\` or \`/aggregate\` for traffic (production only, and only where Web Analytics is enabled).`,
  '- Runtime telemetry keeps its own tools: `get_runtime_logs` and `get_runtime_errors`.',
  '- Evi\'s own Agent Runs (`list_agent_runs`) live in the eve service\'s own project, not the app project. Call `list_agent_run_projects` first to discover it. Still NOT tokens/cost. Use `ai_gateway__*` for that. No per-run trace access: this connection only exposes run-level metadata, never raw conversation content.',
  '- `search_vercel_documentation` needs no ids: general Vercel platform docs search.',
].join(String.fromCharCode(10))

export default defineMcpClientConnection({
  url: 'https://mcp.vercel.com',
  description: VERCEL_MCP_INSTRUCTIONS,
  tools: { allow: ALLOWED_TOOLS },
  auth: adminOnlyAppConnection('vercel/mcp'),
})
