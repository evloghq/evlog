import { mcpChannel } from 'eve/channels/mcp'
import { mcpBearerAuth } from '../lib/mcp'

/**
 * Exposes Evi over the Model Context Protocol at /eve/v1/mcp, for external
 * harnesses (Raycast AI, Claude Code, Cursor), through eve's durable
 * invocation tools: `agent_start`, `agent_get`, `agent_update`,
 * `agent_cancel`. Each start runs a session under `mcp:hugo` that parks
 * after every turn (eve 0.67 removed the conversation/task run modes).
 */
export default mcpChannel({
  auth: mcpBearerAuth,
})
