import { defineCommand } from 'citty'
import { withTelemetry } from '@evlog/telemetry'
import { subCommands } from './commands'
import { COMMON_ARGS } from './lib/command'
import { TELEMETRY_ENDPOINT, TOOL_NAME, VERSION } from './lib/constants'
import { resolveCliEnvironment } from './lib/environment'
import { INIT_TELEMETRY_FIELDS } from './lib/init/telemetry'
import { LOGS_TELEMETRY_FIELDS } from './lib/logs/query'
import { MAP_TELEMETRY_FIELDS } from './lib/map/telemetry-fields'

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
    version: VERSION,
    // Packaged installs report `production`; workspace builds report `development`.
    environment: resolveCliEnvironment(),
    endpoint: TELEMETRY_ENDPOINT,
    /* Which setup options people actually pick and how projects actually score,
       so the flow can lead with the options that get used and the grade bands
       can be calibrated against reality. Values are ids from this CLI's own
       catalog — the allowlist is what keeps a free-text answer from ever being
       sent. */
    collect: { fields: { ...INIT_TELEMETRY_FIELDS, ...LOGS_TELEMETRY_FIELDS, ...MAP_TELEMETRY_FIELDS } },
  },
)

export { TOOL_NAME, VERSION as version }
