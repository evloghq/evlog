import type { CollectConfig, CollectFields, CollectFlags, RunEvent } from './types'

const STANDARD_FIELDS: Array<{ field: string, type: string, description: string }> = [
  { field: 'event', type: 'string', description: 'Always `run`.' },
  { field: 'command', type: 'string', description: 'Command name, auto-captured from citty.' },
  { field: 'durationMs', type: 'number', description: 'Run duration in milliseconds.' },
  { field: 'outcome', type: 'string', description: '`success` or `error`.' },
  { field: 'errorCode', type: 'string', description: 'From typed CLI errors when present.' },
  { field: 'flags', type: 'object', description: 'Flags you passed — booleans/numbers as values, strings as `<set>` unless allowlisted. Positionals, defaults and kebab-case duplicates are dropped.' },
  { field: 'tool.name', type: 'string', description: 'Tool name declared at setup.' },
  { field: 'tool.version', type: 'string', description: 'Tool version declared at setup.' },
  { field: 'env.node', type: 'string', description: 'Node.js version.' },
  { field: 'env.ci', type: 'boolean', description: 'Whether running in CI.' },
  { field: 'env.provider', type: 'string | null', description: 'CI provider when detected.' },
  { field: 'env.tty', type: 'boolean', description: 'Whether stdout is a TTY.' },
  { field: 'env.agent', type: 'string | null', description: 'AI coding agent when detected (claude, cursor, codex, …).' },
  { field: 'env.os', type: 'string | null', description: 'Operating system platform (`darwin`, `linux`, `win32`, …).' },
  { field: 'env.arch', type: 'string | null', description: 'CPU architecture (`arm64`, `x64`, …).' },
  { field: 'env.environment', type: 'string', description: 'Deploy stage (`development` | `preview` | `production`).' },
  { field: 'machineId', type: 'string', description: 'Hashed anonymous machine id; omitted in ephemeral CI.' },
  { field: 'custom', type: 'object', description: 'Consumer-provided fields via telemetry.set() — numbers/booleans by default.' },
]

/** Machine-readable disclosure schema plus rendered markdown for docs/CLI. */
export interface DisclosureDocument {
  version: 1
  standard: typeof STANDARD_FIELDS
  extensions: {
    flags: Record<string, string[]>
    fields: Record<string, string[]>
  }
  markdown: string
}

/**
 * Generate a disclosure document from the standard envelope plus declared `collect` extensions.
 * The output cannot drift from runtime behaviour when `collect` is accurate.
 */
export function generateDisclosure(
  toolName: string,
  collect?: CollectConfig<CollectFlags, CollectFields>,
): DisclosureDocument {
  const flagExtensions: Record<string, string[]> = {}
  const fieldExtensions: Record<string, string[]> = {}

  if (collect?.flags) {
    for (const [key, values] of Object.entries(collect.flags)) {
      flagExtensions[key] = [...values]
    }
  }
  if (collect?.fields) {
    for (const [key, values] of Object.entries(collect.fields)) {
      fieldExtensions[key] = [...values]
    }
  }

  const lines = [
    `# Telemetry disclosure — ${toolName}`,
    '',
    '## Standard envelope (always collected)',
    '',
    '| Field | Type | Description |',
    '| --- | --- | --- |',
    ...STANDARD_FIELDS.map(f => `| \`${f.field}\` | ${f.type} | ${f.description} |`),
  ]

  if (Object.keys(flagExtensions).length > 0) {
    lines.push('', '## Allowlisted flag values', '')
    for (const [flag, values] of Object.entries(flagExtensions)) {
      lines.push(`- \`--${flag}\`: ${values.map(v => `\`${v}\``).join(', ')}`)
    }
  }

  if (Object.keys(fieldExtensions).length > 0) {
    lines.push('', '## Allowlisted custom fields', '')
    for (const [field, values] of Object.entries(fieldExtensions)) {
      lines.push(`- \`${field}\`: ${values.map(v => `\`${v}\``).join(', ')}`)
    }
  }

  lines.push(
    '',
    '## Opt out',
    '',
    '- `DO_NOT_TRACK=1`',
    '- `EVLOG_TELEMETRY=0`',
    '- `evlog telemetry disable` (persisted preference)',
    '',
    '## Debug',
    '',
    'Set `EVLOG_TELEMETRY_DEBUG=1` to print would-be payloads to stderr.',
  )

  return {
    version: 1,
    standard: STANDARD_FIELDS,
    extensions: { flags: flagExtensions, fields: fieldExtensions },
    markdown: lines.join('\n'),
  }
}

/** Example enriched payload for snapshots and docs. */
export function exampleRunEvent(overrides?: Partial<RunEvent>): RunEvent {
  return {
    event: 'run',
    command: 'doctor',
    durationMs: 42,
    outcome: 'success',
    flags: { json: true },
    tool: { name: 'evlog-cli', version: '0.1.0' },
    env: {
      node: '20.11',
      ci: false,
      provider: null,
      tty: true,
      agent: null,
      os: 'darwin',
      arch: 'arm64',
      environment: 'development',
    },
    machineId: 'ab3f0123456789ab',
    custom: { checksFailed: 0 },
    idempotencyKey: '00000000000000000000000000000000',
    timestamp: '2026-07-14T12:00:00.000Z',
    ...overrides,
  }
}
