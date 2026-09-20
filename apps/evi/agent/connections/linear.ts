import { defineMcpClientConnection } from 'eve/connections'
import { adminOnlyAppConnection } from '../lib/connect'

/**
 * The writes Evi's workflows need, plus the reads those workflows depend on:
 * `get_issue` turns a `list_issues` row into detail, and `list_comments` is
 * how a comment is checked against the thread before `save_comment` adds to
 * it. One list, maintained here: a `linear__` tool joins it in the same PR
 * that names it in a skill, an instruction, or this connection's description,
 * so the allowlist never carries more than the described surface. Deletes and
 * structural writes (projects, releases, milestones) stay excluded.
 */
const ALLOWED_TOOLS: string[] = [
  // Reads
  'get_issue',
  'list_comments',
  'list_issues',
  // Writes
  'save_comment',
  'save_document',
  'save_initiative',
  'save_issue',
  'save_status_update',
]

/**
 * Linear's hosted MCP. The bearer token comes from the Linear channel's
 * app-actor connector (`linear/evi`), so Linear attributes the content Evi
 * creates to Evi, the app user, not to the user who authorized the MCP's OAuth
 * connector. Linear accepts the token directly in the Authorization header.
 */
export default defineMcpClientConnection({
  url: 'https://mcp.linear.app/mcp',
  description: 'Hugo\'s Linear workspace (admin only): the authority on what is planned, in progress, or decided. Read issues with get_issue and list_issues, and comment threads with list_comments. Write via save_issue (create or update an issue), save_comment, save_document, save_initiative (create or edit an initiative), and save_status_update (post a project or initiative update, with a health signal). Documents are the home for recurring reports like weekly digests, where formatting beats a chat message. Deletes and structural writes for projects, releases, and milestones stay excluded.',
  tools: { allow: ALLOWED_TOOLS },
  auth: adminOnlyAppConnection('linear/evi'),
})