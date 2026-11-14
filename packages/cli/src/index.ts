import { defineCommand } from 'citty'
import { withTelemetry } from '@evlog/telemetry'
import { subCommands } from './commands'
import { COMMON_ARGS } from './lib/command'
import { TELEMETRY_ENDPOINT, TOOL_NAME, VERSION } from './lib/constants'
import { resolveCliEnvironment } from './lib/environment'
import { TELEMETRY_COLLECT } from './lib/telemetry'

/**
 * The evlog CLI command tree, telemetry-wrapped and ready for `runMain()`.
 * Command bodies live under `commands/` — see `commands/index.ts` to register one.
 */
export const main = withTelemetry(
  defineCommand({
    meta: {
      name: 'evlog',
      description: 'evlog — digging through logs is not observability. it\'s hope · https://evlog.dev',
      version: VERSION,
    },
    args: {
      debug: COMMON_ARGS.debug,
    },
    subCommands,
  }),
  {
    name: TOOL_NAME,
    bin: 'evlog',
    version: VERSION,
    // Packaged installs report `production`; workspace builds report `development`.
    environment: resolveCliEnvironment(),
    endpoint: TELEMETRY_ENDPOINT,
    collect: TELEMETRY_COLLECT,
  },
)

export { TOOL_NAME, VERSION as version }
