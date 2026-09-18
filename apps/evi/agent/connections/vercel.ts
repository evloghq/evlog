import { defineMcpClientConnection } from 'eve/connections'
import { adminOnlyAppConnection } from '../lib/connect'

const { VERCEL_TEAM_ID, EVI_VERCEL_DOCS_PROJECT_ID, EVI_VERCEL_MCP_ROUTE } = process.env

// Follows the Nuxi pattern (nuxt.com layers/nuxi): a team/project-scoped MCP
// route, an explicit read-only allow list, and one instruction block that
// carries the query recipes. The route scope is what route-binds Web Analytics
// to a single project and rejects project overrides from tool arguments, so
// set EVI_VERCEL_MCP_ROUTE to `<team-slug>/<project-slug>` once the docs site
// project is known; absent that, the connection falls back to the unscoped
// server, where Web Analytics calls must pass projectId explicitly.
const VERCEL_MCP_URL = EVI_VERCEL_MCP_ROUTE
  ? `https://mcp.vercel.com/${ EVI_VERCEL_MCP_ROUTE }`
  : 'https://mcp.vercel.com'

// The dedicated tools are the current Vercel MCP surface (the search/call
// endpoint pair is gone from the tools reference, 2026-09-15). The pair stays
// allow-listed because scoped routes may still serve it and it is the
// transport for POST /v2/observability/query; when the server does not serve
// it, the entries are inert.
const ALLOWED_TOOLS: string[] = [
  'search_vercel_documentation',
  'search_vercel_endpoints',
  'call_vercel_endpoint',
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
  'get_agent_run',
]

// get_agent_run_trace is deliberately absent: run-level metadata only, never
// conversation content (see AGENTS.md, What reaches PostHog). Purchase and
// deploy tools are absent: the connection is read-only.

// The description must stay non-empty at build time, when the ids are absent;
// they are only interpolated here, never gated on.
const TEAM_ID = VERCEL_TEAM_ID ?? 'the teamId from VERCEL_TEAM_ID'
const DOCS_PROJECT_ID = EVI_VERCEL_DOCS_PROJECT_ID
  ?? `the projectId from EVI_VERCEL_DOCS_PROJECT_ID`
const ROUTE = EVI_VERCEL_MCP_ROUTE
  ? `route-bound to the \`${ EVI_VERCEL_MCP_ROUTE }\` project`
  : 'not route-bound (set EVI_VERCEL_MCP_ROUTE to `<team-slug>/<project-slug>`)'

const VERCEL_MCP_INSTRUCTIONS = [
  '**Vercel MCP connection (vercel__*, admin only): read-only, use judiciously.**',
  '',
  `- Scoped to the evlog team (${ TEAM_ID }), ${ ROUTE }. The connection covers several evlog projects, so pass the project id when the tool takes one; find ids with \`list_teams\` and \`list_projects\`.`,
  '- Discover exact schemas via `connection_search`, then call `vercel__<tool>`.',
  '',
  '**Self-diagnosis (deployments and builds):**',
  '- `list_deployments` per project filtered by `state` and `sha`, `get_deployment` for one deployment, `get_deployment_build_logs` for the build output of a failed deploy (`errorsOnly: true` returns only the failing lines). Read the logs before proposing a fix.',
  '- `get_runtime_errors` first, then `get_runtime_logs` for runtime behavior; follow those tools\' schemas for explicit ids.',
  '',
  '**Traffic:**',
  '- Browser traffic: `get_web_analytics` (`dataset: \'visits\'` for pageviews, `events` for custom events; `mode: \'count\'` for one total, `aggregate` for grouped rows; dimensions include `requestPath`, `country`, `referrerHostname`, `deviceType`; `filter` is OData, e.g. `requestPath eq \'/docs\'`). Web Analytics is browser-oriented and must not be used to estimate curl, MCP, or raw Markdown traffic.',
  `- Agent-facing HTTP usage (includes CDN/static requests Web Analytics misses): the endpoint call on \`POST /v2/observability/query\` with \`metric='vercel.request.count'\`, \`aggregation: 'sum'\`, ISO \`startTime\` / \`endTime\`, and \`scope={ type: 'project', ownerId: '${ TEAM_ID }', projectIds: ['<project id>'] }\`. Use the docs site project ${ DOCS_PROJECT_ID } unless asked for another.`,
  '- Recipes: MCP transport `request_path eq \'/mcp\' and environment eq \'production\'`. Raw content `endswith(request_path, \'.md\')`. Negotiated Markdown `contains(http_accept, \'text/markdown\')`. Discovery/intake paths: `/llms.txt`, `/llms-full.txt`, `/sitemap.md`, `/.well-known/mcp/server-card.json`. Useful groupings: `client_user_agent`, `bot_category`, `bot_name`, `request_path`, `request_method`, `http_status`, `content_type`.',
  '- Endpoint-call batch/concurrency limits are not a total-query budget: send subsequent read-only batches until every required metric is collected.',
  '- If a response says `truncated: true` or reports `truncation.omittedArrayItems`, only the returned timeseries was shortened. Use the ungrouped `summary` for the complete total; do not call that a traffic/data gap.',
  '- Be precise: `vercel.request.count` counts HTTP requests, not logical tool calls or unique agents. A `.md` path or a `curl/*` user agent alone does not prove AI usage. Treat explicit `Accept: text/markdown`, known AI bot categories, and POST `/mcp` as the stronger signals.',
  '',
  `- Evi's own Agent Runs use the same teamId but a DIFFERENT projectId, the eve service, not the app. Call \`list_agent_run_projects\` first and use that id on \`list_agent_runs\` / \`get_agent_run\`. Still NOT tokens/cost: use \`ai_gateway__*\` for that. Never fetch traces (\`get_agent_run_trace\` is not allowlisted).`,
  '- `search_vercel_documentation` needs no ids: general Vercel platform docs search.',
  '',
  '**Writes:** this connection is read-only. The one write surface is the `set_vercel_env` tool, which upserts a single non-secret environment variable on one project and is policy-gated (allowlisted agent-config keys on writable projects run on their own; anything else raises an Approve card; secret-shaped keys are refused outright). When a Vercel write is needed, call `set_vercel_env` and wait for the approval, instead of explaining CLI commands or asking the user to paste values.',
].join(String.fromCharCode(10))

export default defineMcpClientConnection({
  url: VERCEL_MCP_URL,
  description: VERCEL_MCP_INSTRUCTIONS,
  tools: { allow: ALLOWED_TOOLS },
  auth: adminOnlyAppConnection('vercel/mcp'),
})
