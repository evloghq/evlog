import { defineErrorCatalog } from 'evlog'
import { FRAMEWORK_IDS, INIT_FRAMEWORK_IDS } from './frameworks'

/**
 * Typed error catalog for `@evlog/cli`.
 *
 * Wire codes are `cli.<KEY>` (e.g. `cli.EVLOG_NOT_FOUND`). Used when a
 * command aborts, and attached as `findings[].code` on `--debug` wide events
 * so a failed doctor check carries why / fix / link without throwing.
 */
export const cliErrors = defineErrorCatalog('cli', {
  NODE_TOO_OLD: {
    status: 400,
    message: ({ version, min }: { version: string, min: number }) =>
      `Node ${version} is too old (need >= ${min})`,
    why: 'The evlog CLI requires a modern Node runtime',
    fix: 'Upgrade Node to the latest LTS',
    link: 'https://nodejs.org/',
    tags: ['doctor', 'environment'],
  },
  PROJECT_NO_PACKAGE: {
    status: 404,
    message: 'No package.json found',
    why: 'Doctor needs a package root to diagnose the project',
    fix: 'Run from your app directory or pass --cwd',
    tags: ['doctor', 'project'],
  },
  EVLOG_NOT_FOUND: {
    status: 404,
    message: 'evlog is not installed in this project',
    why: 'No resolvable evlog package in node_modules and no declaration in package.json',
    fix: 'pnpm add evlog — see installation docs',
    link: 'https://evlog.dev/getting-started/installation',
    tags: ['doctor', 'evlog'],
  },
  EVLOG_DECLARED_NOT_INSTALLED: {
    status: 404,
    message: ({ range }: { range: string }) =>
      `evlog is declared (${range}) but not installed`,
    why: 'package.json lists evlog but node_modules resolve failed',
    fix: 'Run your package manager install step',
    tags: ['doctor', 'evlog'],
  },
  COMMAND_FAILED: {
    status: 500,
    message: 'CLI command failed',
    why: 'An unexpected error aborted the command',
    fix: 'Re-run with --debug and share the wide event',
    tags: ['cli'],
  },
  MAP_NO_PACKAGE_JSON: {
    status: 404,
    message: 'No package.json found',
    why: 'map needs a package root to detect the framework and scan routes',
    fix: 'Run from your app directory or pass --cwd',
    tags: ['map', 'project'],
  },
  MAP_WORKSPACE_ROOT: {
    status: 400,
    message: 'Monorepo root detected with no supported framework',
    why: 'map scans one app at a time and cannot infer a framework from a bare workspace root',
    fix: 'Run from an app directory (e.g. apps/web) or pass --cwd',
    tags: ['map', 'project'],
  },
  MAP_FRAMEWORK_NOT_DETECTED: {
    status: 400,
    message: 'Could not detect a supported framework (nuxt, nitro, next, tanstack-start, hono)',
    why: 'No matching dependency or config file was found in this project',
    fix: 'Use --framework <name> to override detection',
    tags: ['map', 'project'],
  },
  MAP_INVALID_FRAMEWORK: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Unknown --framework "${value}"`,
    why: `map only ships adapters for ${FRAMEWORK_IDS.join(', ')}`,
    fix: `Pass one of: ${FRAMEWORK_IDS.join(', ')}`,
    tags: ['map'],
  },
  INIT_INVALID_FRAMEWORK: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Unknown --framework "${value}"`,
    why: `init only knows how to wire ${INIT_FRAMEWORK_IDS.join(', ')}`,
    fix: `Pass one of: ${INIT_FRAMEWORK_IDS.join(', ')} — or omit it and let detection decide`,
    link: 'https://evlog.dev/cli/init',
    tags: ['init'],
  },
  INIT_FRAMEWORK_UNSUPPORTED: {
    status: 400,
    message: ({ framework }: { framework: string }) =>
      `evlog init cannot wire ${framework} yet`,
    why: 'The framework has a map adapter, but init has no wiring plan for it',
    fix: 'Wire evlog by hand following the framework guide, then run evlog map to score coverage',
    link: 'https://evlog.dev/integrate/frameworks/overview',
    tags: ['init'],
  },
  INIT_INVALID_ENRICHER: {
    status: 400,
    message: ({ value, known }: { value: string, known: string }) =>
      `Unknown --enrichers entry "${value}" — pass a comma-separated list of: ${known}`,
    why: 'Enrichers are a fixed set, so a typo would silently wire one fewer',
    fix: 'Run evlog init without --enrichers to pick from the list interactively',
    link: 'https://evlog.dev/use-cases/enrichers',
    tags: ['init'],
  },
  INIT_INVALID_SAMPLING: {
    status: 400,
    message: ({ value, known }: { value: string, known: string }) =>
      `Unknown --sampling "${value}" — pass one of: ${known}`,
    why: 'Sampling is a fixed set of traffic tiers, not a rate',
    fix: 'Run evlog init without --sampling to pick a tier interactively',
    link: 'https://evlog.dev/cli/init',
    tags: ['init'],
  },
  INIT_NO_APPS: {
    status: 400,
    message: ({ value, known }: { value: string, known: string }) =>
      `No workspace app matches "${value}" — this workspace has: ${known}`,
    why: 'Setting up nothing is never what --apps was meant to express',
    fix: 'Name the packages by their directory (apps/web) or their package.json name',
    link: 'https://evlog.dev/cli/init',
    tags: ['init', 'workspace'],
  },
  INIT_INVALID_DRAIN: {
    status: 400,
    /* The known ids come from the catalog rather than being spelled out here:
       a fixed list in an error message is a list that goes stale the first time
       an adapter is added. */
    message: ({ value, known }: { value: string, known: string }) =>
      `Unknown --drain "${value}" — pass one of: ${known}`,
    why: 'A destination that is not in the catalog cannot be wired, and defaulting instead would send events somewhere the author did not ask for',
    fix: 'Run evlog init without --drain to pick from the list interactively',
    link: 'https://evlog.dev/integrate/adapters/overview',
    tags: ['init'],
  },
  INIT_INVALID_EXTRA: {
    status: 400,
    message: ({ value, known }: { value: string, known: string }) =>
      `Unknown --extras entry "${value}" — pass a comma-separated list of: ${known}`,
    why: 'Extras are a fixed set, so a typo would silently do nothing',
    fix: 'Run evlog init without --extras to pick from the list interactively',
    link: 'https://evlog.dev/cli/init',
    tags: ['init'],
  },
  AGENTS_INVALID_SOURCE: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Invalid --source "${value}" — expected an http(s) URL`,
    why: 'The source is handed to npx, and on Windows that argument reaches a shell',
    fix: 'Pass the origin the skills are published from, e.g. --source https://www.evlog.dev',
    link: 'https://evlog.dev/cli/agents',
    tags: ['agents', 'skills'],
  },
  AGENTS_INVALID_SKILL: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Invalid --skills entry "${value}"`,
    why: 'Skill names are lowercase and dashed, and the value is handed to npx',
    fix: 'Run evlog agents without --skills to install every published skill',
    link: 'https://evlog.dev/reference/agent-skills',
    tags: ['agents', 'skills'],
  },
  AGENTS_UNREADABLE: {
    status: 500,
    message: ({ file }: { file: string }) => `Cannot read ${file}`,
    why: 'The path exists but could not be read — it may be a directory, or permissions may deny it',
    fix: 'Check the file and its permissions, then run the command again',
    link: 'https://evlog.dev/cli/agents',
    tags: ['agents'],
  },
  MAP_BASELINE_NOT_FOUND: {
    status: 404,
    message: ({ source }: { source: string }) =>
      `No baseline map at ${source}`,
    why: 'A baseline gate compares against a committed evlog.map.json, and none was readable',
    fix: 'Run evlog map once and commit evlog.map.json, or pass --baseline <path>',
    link: 'https://evlog.dev/cli/ci',
    tags: ['map', 'baseline'],
  },
  MAP_BASELINE_REF_NOT_FOUND: {
    status: 404,
    message: ({ ref }: { ref: string }) =>
      `No git ref ${ref}`,
    why: '--baseline git:<ref> reads the committed evlog.map.json from that ref, and the ref does not exist',
    fix: 'Point --baseline at a branch or tag that exists, e.g. git:origin/main',
    link: 'https://evlog.dev/cli/ci',
    tags: ['map', 'baseline'],
  },
  MAP_BASELINE_NOT_COMMITTED: {
    status: 404,
    message: ({ ref }: { ref: string }) =>
      `No evlog.map.json in ${ref}, and the ratchet needs a committed map`,
    why: 'The ratchet compares against a committed evlog.map.json, so a file that was never tracked cannot be read through git',
    fix: 'Commit one from the base branch: evlog map && git add -f evlog.map.json',
    link: 'https://evlog.dev/cli/ci',
    tags: ['map', 'baseline'],
  },
  MAP_BASELINE_INVALID: {
    status: 400,
    message: ({ source, reason }: { source: string, reason: string }) =>
      `Baseline ${source} is unusable — ${reason}`,
    why: 'The baseline has to be an evlog.map.json written by this CLI to be comparable',
    fix: 'Regenerate it with evlog map, or point --baseline at the right file',
    link: 'https://evlog.dev/cli/ci',
    tags: ['map', 'baseline'],
  },
  MAP_BASELINE_VERSION_MISMATCH: {
    status: 400,
    message: ({ baselineCli, runningCli, baselineRuleSet, runningRuleSet }: { baselineCli: string, runningCli: string, baselineRuleSet: number, runningRuleSet: number }) =>
      `baseline was written by @evlog/cli ${baselineCli}, running @evlog/cli ${runningCli} (rule set ${baselineRuleSet} \u2192 ${runningRuleSet})`,
    why: 'The rule set changed between the two versions, so a per-check diff could blame code the PR did not touch',
    fix: 'Regenerate the baseline: evlog map && git add evlog.map.json',
    link: 'https://evlog.dev/cli/ci',
    tags: ['map', 'baseline'],
  },
  MAP_INVALID_MIN_SCORE: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Invalid --min-score "${value}"`,
    why: 'A gate that cannot be read is a gate that never fails, and CI would go green on a threshold nobody applied',
    fix: 'Pass a whole number between 0 and 100, e.g. --min-score 80',
    tags: ['map'],
  },
  MAP_INVALID_FORMAT: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Unknown --format "${value}"`,
    why: 'map renders human, json and github (workflow annotations)',
    fix: 'Pass one of: human, json, github',
    tags: ['map'],
  },
  MAP_INVALID_LIMIT: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Invalid --limit "${value}"`,
    why: 'The limit caps how many annotations reach the pull request, and a cap that cannot be read would silently become the default',
    fix: 'Pass a whole number of 1 or more, e.g. --limit 10',
    tags: ['map'],
  },
  MAP_FORMAT_CONFLICT: {
    status: 400,
    message: ({ format }: { format: string }) =>
      `--json and --format ${format} both claim stdout`,
    why: 'Each format is a different contract on stdout, and a consumer can only parse one of them',
    fix: 'Drop --json, or pass --format json',
    tags: ['map'],
  },
  LOGS_NO_SINK: {
    status: 404,
    message: ({ cwd }: { cwd: string }) =>
      `No local logs under ${cwd}`,
    why: 'There is no .evlog/logs directory here and no fs drain is configured, so nothing has been written to read',
    fix: 'Run evlog init --drain fs, start the app and make a request, or pass --dir <path>',
    link: 'https://evlog.dev/cli/logs',
    tags: ['logs'],
  },
  LOGS_INVALID_TIME: {
    status: 400,
    message: ({ flag, value }: { flag: string, value: string }) =>
      `Invalid --${flag} "${value}"`,
    why: 'A time bound that cannot be read would silently become no bound, and the run would show everything',
    fix: 'Pass a duration back from now (15m, 2h, 3d) or a date (2026-10-01, 2026-10-01T09:00)',
    tags: ['logs'],
  },
  LOGS_INVALID_LEVEL: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Unknown level "${value}"`,
    why: 'Levels are the six evlog writes',
    fix: 'Pass one or more of: trace, debug, info, warn, error, fatal',
    tags: ['logs'],
  },
  LOGS_INVALID_STATUS: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Invalid --status "${value}"`,
    why: 'A status filter that cannot be read would silently match nothing',
    fix: 'Pass a status (404) or a class (4xx)',
    tags: ['logs'],
  },
  LOGS_INVALID_DURATION: {
    status: 400,
    message: ({ flag, value }: { flag: string, value: string }) =>
      `Invalid --${flag} "${value}"`,
    why: 'A duration that cannot be read would silently fall back to the default',
    fix: 'Pass milliseconds (500) or a unit (500ms, 1.5s)',
    tags: ['logs'],
  },
  LOGS_INVALID_WHERE: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Invalid --where "${value}"`,
    why: 'A clause that cannot be read would silently match everything',
    fix: 'Write field=value, field!=value, field>n, field>=n, field<n, field<=n, field~regex, field (present) or !field (absent); dotted fields reach into objects',
    tags: ['logs'],
  },
  LOGS_URL_UNREACHABLE: {
    status: 502,
    message: ({ url, reason }: { url: string, reason: string }) =>
      `Could not read events from ${url}: ${reason}`,
    why: 'The memory drain only exists while the app runs, and only where the app exposes readMemoryLogs() over HTTP',
    fix: 'Start the app, check the endpoint returns a JSON array of events, and pass its URL to --url',
    link: 'https://evlog.dev/cli/logs',
    tags: ['logs'],
  },
  LOGS_INVALID_LIMIT: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Invalid --limit "${value}"`,
    why: 'A limit that cannot be read would silently become the default',
    fix: 'Pass a whole number of 1 or more, e.g. --limit 20',
    tags: ['logs'],
  },
  CONFIG_PARSE_FAILED: {
    status: 400,
    message: ({ file, reason }: { file: string, reason: string }) =>
      `Could not parse ${file}: ${reason}`,
    why: 'The CLI reads evlog.config without running it, so the file has to parse on its own',
    fix: 'Fix the syntax error and run the command again',
    link: 'https://evlog.dev/cli/config',
    tags: ['config'],
  },
  CONFIG_NO_EXPORT: {
    status: 400,
    message: ({ file, name }: { file: string, name: string }) =>
      `${file} has no ${name === 'default' ? 'default export' : `export named ${name}`} the CLI can read`,
    why: 'The CLI reads the object literal passed to defineEvlog, through same-file consts and relative imports',
    fix: 'Write the config as export default defineEvlog({ ... })',
    link: 'https://evlog.dev/cli/config',
    tags: ['config'],
  },
  CONFIG_NOT_STATIC: {
    status: 400,
    message: ({ key, at }: { key: string, at: string }) =>
      `${key} in ${at} is computed at runtime`,
    why: 'The CLI reads evlog.config without running it, so map and logs settings have to be literals',
    fix: 'Write the value inline, as a const, or import it from a local file',
    link: 'https://evlog.dev/cli/config',
    tags: ['config'],
  },
  CONFIG_INVALID: {
    status: 400,
    message: ({ key, at, problem }: { key: string, at: string, problem: string }) =>
      `${key} in ${at} ${problem}`,
    why: 'A setting the CLI cannot read would silently fall back to its default',
    fix: 'Use a setting and a value the config reference lists',
    link: 'https://evlog.dev/cli/config',
    tags: ['config'],
  },
  CONFIG_EXTENDS_NOT_FOUND: {
    status: 404,
    message: ({ specifier, at }: { specifier: string, at: string }) =>
      `Cannot resolve "${specifier}", extended in ${at}`,
    why: 'The CLI follows extends to read the parent config, and the import does not lead to a file',
    fix: 'Install the package, or correct the import path',
    link: 'https://evlog.dev/cli/config',
    tags: ['config'],
  },
  CONFIG_EXTENDS_DEPTH: {
    status: 400,
    message: ({ parent, at }: { parent: string, at: string }) =>
      `${parent} extends another config, so ${at} cannot extend it`,
    why: 'A config extends one level only, so every setting is at most one file away from where it applies',
    fix: 'Extend the config it extends directly, or copy the settings you need into one of the two files',
    link: 'https://evlog.dev/cli/config',
    tags: ['config'],
  },
})

declare module 'evlog' {
  interface RegisteredErrorCatalogs {
    cli: typeof cliErrors
  }
}
