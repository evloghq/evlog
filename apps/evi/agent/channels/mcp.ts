import { mcpChannel } from 'eve/channels/mcp'
import { maintainerBearerAuth } from '../lib/maintainer-auth'

/**
 * Exposes Evi over the Model Context Protocol at /eve/v1/mcp, for external
 * harnesses (Raycast AI, Claude Code, Cursor), through eve's durable
 * invocation tools: `agent_start`, `agent_get`, `agent_update`,
 * `agent_cancel`. Each start runs a task-mode session under `mcp:hugo`.
 */
export default mcpChannel({
  auth: maintainerBearerAuth,
})
