import { defineTelemetryCommands } from '@evlog/telemetry'
import type { CommandDef, SubCommandsDef } from 'citty'
import { defineCommand } from 'citty'
import { TOOL_NAME } from '../lib/constants'
import { defineEvlogCommand } from '../lib/command'
import type { EvlogCommandDef } from '../lib/command'

const tree = defineTelemetryCommands({ name: TOOL_NAME })

/**
 * `evlog telemetry *` — `@evlog/telemetry` consent commands, each leaf wrapped
 * with the branded header and the shared flags like any other command.
 */
export default defineCommand({
  meta: tree.meta,
  async subCommands() {
    const leaves = (typeof tree.subCommands === 'function' ? await tree.subCommands() : await tree.subCommands) as SubCommandsDef
    return Object.fromEntries(
      Object.entries(leaves).map(([key, leaf]) => {
        const { meta, run } = leaf as CommandDef
        return [key, defineEvlogCommand<{}>(`telemetry ${key}`, { meta, run: run as EvlogCommandDef['run'] })]
      }),
    )
  },
})
