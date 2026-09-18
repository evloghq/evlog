import { defineOpenAPIConnection } from 'eve/connections'
import { adminOnlyAppConnection } from '../lib/connect'

const { VERCEL_TEAM_ID, EVI_VERCEL_DOCS_PROJECT_ID, EVI_VERCEL_API_CONNECTOR } = process.env

// Read-only surface of the Vercel Observability Query API. One operation is
// allow-listed and it is a query; nothing on this connection can mutate a
// project, buy, or deploy.
//
// The Vercel MCP server no longer serves the search/call-endpoint pair that
// used to reach this API, so the queries go through an OpenAPI connection
// authenticated with a Vercel Connect connector instead. The connector UID
// defaults to 'vercel/api'; set EVI_VERCEL_API_CONNECTOR to override it, and
// attach the connector to this project in the Vercel dashboard before the
// tools become usable.
const VERCEL_API_CONNECTOR = EVI_VERCEL_API_CONNECTOR ?? 'vercel/api'

// The description must stay non-empty at build time, when VERCEL_TEAM_ID or
// EVI_VERCEL_DOCS_PROJECT_ID are absent; they are only interpolated here,
// never gated on.
const TEAM_ID = VERCEL_TEAM_ID ?? 'the teamId from VERCEL_TEAM_ID'
const DOCS_PROJECT_ID = EVI_VERCEL_DOCS_PROJECT_ID
  ?? 'the projectId from EVI_VERCEL_DOCS_PROJECT_ID'

const VERCEL_OBSERVABILITY_INSTRUCTIONS = [
  '**Vercel Observability connection (vercel-observability__*, admin only): read-only, use judiciously.**',
  '',
  `- The only operation is \`queryObservability\` (POST /v2/observability/query), pre-scoped to the evlog team (${ TEAM_ID }). Pass \`scope\` with \`type: 'project'\`, \`ownerId: '${ TEAM_ID }'\`, and the project id(s) to query; the docs site is ${ DOCS_PROJECT_ID }.`,
  '- Body: `metric` (use `vercel.request.count`), `aggregation: \'sum\'`, ISO UTC `startTime` / `endTime`, optional OData `filter`, `groupBy` (array of field names), and `limit`.',
  '- Always filter to `environment eq \'production\'`, and when a number is shown against a comparison, query the requested window and the preceding equal-length window with the same scope and filter.',
  '- If a response says `truncated: true` or reports `truncation.omittedArrayItems`, only the returned timeseries was shortened. Use the ungrouped `summary` for the complete total; do not report that as a data gap.',
  '- `vercel.request.count` counts HTTP requests, not logical tool calls or unique agents. Web Analytics (`vercel__get_web_analytics`) is browser-oriented and must not be used to estimate curl, MCP, or raw Markdown traffic.',
].join(String.fromCharCode(10))

const scopeSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['project'] },
    ownerId: { type: 'string' },
    projectIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['type', 'ownerId', 'projectIds'],
} as const

// Hand-authored inline spec: one read-only operation. Prefer an inline object
// over a fetched spec when the contract is this small (eve/connections docs).
const spec = {
  openapi: '3.0.0',
  info: {
    title: 'Vercel Observability Query API',
    version: '1.0.0',
    description: VERCEL_OBSERVABILITY_INSTRUCTIONS,
  },
  servers: [{ url: 'https://api.vercel.com' }],
  paths: {
    '/v2/observability/query': {
      post: {
        operationId: 'queryObservability',
        summary: 'Query aggregated observability metrics for evlog projects (read-only).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  metric: { type: 'string', examples: ['vercel.request.count'] },
                  aggregation: { type: 'string', examples: ['sum'] },
                  startTime: { type: 'string', description: 'ISO 8601 UTC timestamp.' },
                  endTime: { type: 'string', description: 'ISO 8601 UTC timestamp.' },
                  scope: scopeSchema,
                  filter: { type: 'string', description: 'OData filter, e.g. environment eq \'production\'.' },
                  groupBy: { type: 'array', items: { type: 'string' } },
                  limit: { type: 'number' },
                },
                required: ['metric', 'aggregation', 'startTime', 'endTime', 'scope'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Query result.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
} as const

export default defineOpenAPIConnection({
  spec,
  description: VERCEL_OBSERVABILITY_INSTRUCTIONS,
  operations: { allow: ['queryObservability'] },
  auth: adminOnlyAppConnection(VERCEL_API_CONNECTOR),
})
