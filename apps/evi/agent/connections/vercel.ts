import { defineMcpClientConnection } from 'eve/connections'
import { adminOnlyAppConnection } from '../lib/connect'

const { VERCEL_TEAM_ID } = process.env

// Read-only surface of the Vercel MCP server. Per-run Agent Run detail
// (get_agent_run, get_agent_run_trace) is deliberately absent: this connection
// carries run-level metadata only, never raw conversation content. Purchase and
// deploy tools are absent because the connection is read-only.
const ALLOWED_TOOLS: string[] = [
  'search_vercel_documentation',
  'list_teams',
  'list_projects',
  'get_project',
  'list_deployments',
  'get_deployment',
  'get_deployment_build_logs',
  'get_runtime_logs',
  'get_runtime_errors',
  'get_web_analytics',
  'list_agent_run_projects',
  'list_agent_runs',
]

// The description must stay non-empty at build time, when VERCEL_TEAM_ID is
// absent; it is only interpolated here, never gated on.
const TEAM_ID = VERCEL_TEAM_ID ? `teamId=${VERCEL_TEAM_ID}` : 'the teamId from VERCEL_TEAM_ID'

const VERCEL_MCP_INSTRUCTIONS = [
  '**Vercel MCP connection (vercel__*, admin only): read-only, use judiciously.**',
  '',
  `- The connection is scoped to the evlog team (${ TEAM_ID }) but NOT to a single project: evlog runs several Vercel projects, so pass the team id, and the project id when the tool takes one. Find ids with \`list_teams\` and \`list_projects\`.`,
  '- Deployments and builds: `list_deployments` per project (state, target), `get_deployment` for one, and `get_deployment_build_logs` for the build output of a failed deploy (`errorsOnly: true` returns only the failing lines).',
  '- Web Analytics: `get_web_analytics`, mode `count` for totals and `aggregate` for grouped rows (production only, and only where Web Analytics is enabled).',
  '- Runtime telemetry: `get_runtime_logs` and `get_runtime_errors`.',
  '- Evi\'s own Agent Runs (`list_agent_run_projects`, `list_agent_runs`) live in the eve service\'s own project, not the app project. Call `list_agent_run_projects` first to discover it. Still NOT tokens/cost. Use `ai_gateway__*` for that. Per-run detail (`get_agent_run`, `get_agent_run_trace`) is not allowlisted: this connection exposes run-level metadata only, never raw conversation content.',
  '- `search_vercel_documentation` needs no ids: general Vercel platform docs search.',
].join(String.fromCharCode(10))

export default defineMcpClientConnection({
  url: 'https://mcp.vercel.com',
  description: VERCEL_MCP_INSTRUCTIONS,
  tools: { allow: ALLOWED_TOOLS },
  auth: adminOnlyAppConnection('vercel/mcp'),
})
