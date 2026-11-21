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
  UNKNOWN_FLAG: {
    status: 400,
    message: ({ flag }: { flag: string }) => `Unknown flag ${flag}`,
    why: 'The command does not declare this flag, and running without it would skip the gate or the option it was meant to set',
    fix: 'Check the spelling against the command\'s --help',
    tags: ['cli', 'usage'],
  },
  FLAG_NEEDS_VALUE: {
    status: 400,
    message: ({ flag }: { flag: string }) => `${flag} needs a value`,
    why: 'The flag was last or followed by another flag, and reading it as unset would run the command without the option',
    fix: 'Pass a value after it, or write --flag=value when the value starts with a dash',
    tags: ['cli', 'usage'],
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
    message: `Could not detect a supported framework (${FRAMEWORK_IDS.join(', ')})`,
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
  INIT_EVE_TOO_OLD: {
    status: 400,
    message: ({ range }: { range: string }) =>
      `This eve agent is on eve ${range}, and @evlog/eve needs eve 1.0 or later`,
    why: '@evlog/eve is an eve 1.0 extension; earlier eve has no extensions to mount it from',
    fix: 'Upgrade eve to 1.0 or later, then run evlog init again',
    link: 'https://evlog.dev/use-cases/eve',
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
  AGENTS_MARKERS_UNPAIRED: {
    status: 400,
    message: 'The evlog markers in AGENTS.md are not one start and end pair',
    why: 'The block is rewritten between <!-- evlog:start --> and <!-- evlog:end -->, each alone on its line. With one missing, repeated or out of order, a rewrite would delete text that is yours',
    fix: 'Restore the pair around the evlog section, or delete the leftover marker with the old section, then run the command again',
    link: 'https://evlog.dev/cli/agents',
    tags: ['agents'],
  },
  WRITE_FAILED: {
    status: 500,
    message: ({ file, reason, written }: { file: string, reason: string, written: readonly string[] }) =>
      `Could not write ${file} (${reason}). ${written.length > 0 ? `Written before it: ${written.join(', ')}` : 'No file was written before it'}`,
    why: 'The run stops at the first file it cannot write, so the files planned after it were not attempted',
    fix: 'Check the path and its permissions, then run the command again. Files already in place are left as they are',
    tags: ['init', 'agents'],
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
  MAP_PARSE_FAILED: {
    status: 422,
    message: ({ file, error, more }: { file: string, error: string, more: number }) =>
      `${file} failed to parse: ${error}${more > 0 ? `, and ${more} more file${more === 1 ? '' : 's'}` : ''}`,
    why: 'A gate cannot pass a tree it could not read: the entry points in that file are not in the score or in the comparison',
    fix: 'Fix the file, or list it under map.ignore in evlog.config if it is not app code',
    link: 'https://evlog.dev/cli/ci',
    tags: ['map'],
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
  LOGS_ASK_UNAVAILABLE: {
    status: 501,
    message: ({ reason }: { reason: string }) =>
      `--ask needs @evlog/signals and ai: ${reason}`,
    why: 'A question is answered by a decision model through @evlog/signals, which the CLI loads from where the CLI itself is installed, only when --ask is passed. A CLI fetched by npx or bunx cannot see packages installed in the project',
    fix: 'Install the CLI beside them in the project and run it from there: pnpm add -D @evlog/cli @evlog/signals \'ai@^7.0.130\', then pnpm evlog logs --ask',
    link: 'https://evlog.dev/cli/logs',
    tags: ['logs'],
  },
  LOGS_ASK_FAILED: {
    status: 502,
    message: ({ reason }: { reason: string }) =>
      `The model could not answer --ask: ${reason}`,
    why: 'Every selected event is judged, so a failed call would leave holes in the ranking; the run stops at the first one instead',
    fix: 'Check AI_GATEWAY_API_KEY and that the gateway allows typesafe-ai, or narrow the events with --limit and retry',
    link: 'https://evlog.dev/cli/logs',
    tags: ['logs'],
  },
  LOGS_ASK_UNSUPPORTED: {
    status: 400,
    message: ({ with: other }: { with: string }) =>
      `--ask cannot be combined with ${other}`,
    why: 'A question ranks a finite set of events, one model call each; a follow never ends and stats keeps no events to rank',
    fix: 'Drop --follow or the stats view, and narrow the events with --since, --where or --limit instead',
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
  LOGS_INVALID_SOURCE: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Unknown --source "${value}"`,
    why: 'A source that cannot be read would silently fall back to local files',
    fix: 'Pass files (the default) or vercel',
    tags: ['logs'],
  },
  LOGS_SOURCE_CONFLICT: {
    status: 400,
    message: ({ flag }: { flag: string }) =>
      `--source vercel cannot be combined with --${flag}`,
    why: 'The Vercel source reads the linked project\'s runtime logs over a time window, so a directory, a URL or a follow has nothing to apply to',
    fix: 'Drop that flag, or drop --source vercel to read local files',
    tags: ['logs'],
  },
  LOGS_VERCEL_NOT_LINKED: {
    status: 404,
    message: ({ cwd }: { cwd: string }) =>
      `No Vercel project is linked at ${cwd}`,
    why: 'The Vercel source reads the runtime logs of the project vercel link linked, and only that one',
    fix: 'Run vercel link, then npx evlog setup vercel',
    link: 'https://evlog.dev/cli/logs',
    tags: ['logs', 'vercel'],
  },
  LOGS_SOURCE_MISMATCH: {
    status: 409,
    message: ({ expected, actual }: { expected: string, actual: string }) =>
      `Expected ${expected}, but this reads ${actual}`,
    why: 'An empty result from the wrong source would read as an answer about the one you asked for',
    fix: 'Pass --source vercel for the linked project\'s runtime logs, or drop --expect',
    link: 'https://evlog.dev/cli/logs',
    tags: ['logs'],
  },
  LOGS_VERCEL_NO_TOKEN: {
    status: 401,
    message: ({ reason }: { reason: string }) =>
      `No OIDC token for the linked Vercel project: ${reason}`,
    why: 'Vercel Connect accepts the project\'s OIDC token, which the CLI refreshes with your Vercel login',
    fix: 'Run vercel login, check vercel link points at the project, and try again',
    link: 'https://evlog.dev/cli/logs',
    tags: ['logs', 'vercel'],
  },
  LOGS_VERCEL_NO_CONNECTOR: {
    status: 412,
    message: 'Vercel logs are not set up: evlog.config names no logs.vercel.connector',
    why: 'Runtime logs are read through a Vercel Connect connector the project names, never one evlog picks for it',
    fix: 'Run npx evlog setup vercel: it offers the team\'s connectors and writes the one you pick to evlog.config.ts',
    link: 'https://evlog.dev/cli/logs',
    tags: ['logs', 'vercel'],
  },
  LOGS_VERCEL_NOT_SET_UP: {
    status: 403,
    message: ({ connector, reason }: { connector: string, reason: string }) =>
      `Vercel Connect issued no token for ${connector}: ${reason}`,
    why: 'The connector does not exist on the team, or is not attached to this project and environment',
    fix: 'Run npx evlog setup vercel',
    link: 'https://evlog.dev/cli/logs',
    tags: ['logs', 'vercel'],
  },
  LOGS_VERCEL_READ_FAILED: {
    status: 502,
    message: ({ httpStatus, reason }: { httpStatus: number, reason: string }) =>
      `Vercel refused the read (${httpStatus}): ${reason}`,
    why: 'The observability API answered the runtime logs query with an error. A 403 means the access token stored in the connector cannot read runtime logs',
    fix: 'On a 403, replace the connector\'s API key with a Vercel access token scoped to the team. Otherwise check the window is inside the plan\'s log retention (Hobby 1 hour, Pro 1 day), or narrow --since',
    link: 'https://vercel.com/docs/logs/runtime',
    tags: ['logs', 'vercel'],
  },
  SETUP_INVALID_TARGET: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `Unknown setup target "${value}"`,
    why: 'evlog setup only knows the platforms it can read logs from, and eve',
    fix: 'Run evlog setup vercel, or evlog setup eve',
    tags: ['setup'],
  },
  SETUP_INVALID_ENVIRONMENT: {
    status: 400,
    message: ({ value }: { value: string }) =>
      value ? `"${value}" is not a Vercel environment name` : 'No environment to attach the connector for',
    why: 'The connector is attached only for the environments named, and a name is passed to the Vercel CLI as is',
    fix: 'Pass environment names separated by commas, such as --environment production,development',
    tags: ['setup', 'vercel'],
  },
  SETUP_VERCEL_NO_CONNECTOR: {
    status: 400,
    message: ({ reusable }: { reusable: string[] }) =>
      `No connector chosen to read Vercel logs through. ${reusable.length > 0 ? `The team has ${reusable.join(', ')}` : 'The team has no Vercel API-key connector'}`,
    why: 'Setup reads through the connector you pick, or creates one you name, and this run cannot ask',
    fix: 'Pass --connector with one of the team\'s connectors, or --connector vercel/<name> --create to create one',
    link: 'https://evlog.dev/cli/logs',
    tags: ['setup', 'vercel'],
  },
  SETUP_INVALID_CONNECTOR: {
    status: 400,
    message: ({ value }: { value: string }) =>
      `"${value}" is not a Vercel connector UID that can be created`,
    why: 'Setup creates Vercel API-key connectors, whose UID is vercel/ followed by the name',
    fix: 'Pass --connector vercel/<name>, such as vercel/evlog, with --create',
    tags: ['setup', 'vercel'],
  },
  SETUP_VERCEL_FAILED: {
    status: 500,
    message: ({ step, reason }: { step: string, reason: string }) =>
      `${step} failed: ${reason}`,
    why: 'A step of the setup did not complete, so the agent cannot read its logs yet',
    fix: 'Run the step yourself, then run npx evlog setup vercel again; it skips what is already done',
    link: 'https://evlog.dev/cli/logs',
    tags: ['setup', 'vercel'],
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
  CONFIG_EXTENDS_STRING: {
    status: 400,
    message: ({ specifier, at }: { specifier: string, at: string }) =>
      `extends in ${at} is the path '${specifier}', not a config`,
    why: 'extends takes the config itself, the same value the app merges at runtime, so a path is never resolved',
    fix: 'Import the config from that path as base, then set extends: base',
    link: 'https://evlog.dev/cli/config',
    tags: ['config'],
  },
  UPGRADE_NO_PACKAGE_JSON: {
    status: 404,
    message: 'No package.json found',
    why: 'upgrade reads the evlog version and rewrites code under the package root',
    fix: 'Run from your app directory or pass --cwd',
    tags: ['upgrade', 'project'],
  },
  UPGRADE_NO_EVLOG: {
    status: 404,
    message: 'No evlog version to upgrade from',
    why: 'package.json declares no evlog range with a version and no evlog is installed',
    fix: 'Run upgrade in the package that depends on evlog',
    tags: ['upgrade', 'evlog'],
  },
  UPGRADE_DIRTY_TREE: {
    status: 409,
    message: 'The project has uncommitted changes',
    why: '--write rewrites files in place, and a clean tree keeps its changes reviewable and easy to revert',
    fix: 'Commit or stash first, or pass --force',
    tags: ['upgrade'],
  },
})

/* Errors about how the command was invoked rather than about the project. */
const USAGE_ERRORS = new Set<string>([
  cliErrors.UNKNOWN_FLAG,
  cliErrors.FLAG_NEEDS_VALUE,
  cliErrors.MAP_INVALID_FRAMEWORK,
  cliErrors.MAP_INVALID_MIN_SCORE,
  cliErrors.MAP_INVALID_FORMAT,
  cliErrors.MAP_INVALID_LIMIT,
  cliErrors.MAP_FORMAT_CONFLICT,
  cliErrors.MAP_BASELINE_VERSION_MISMATCH,
  cliErrors.INIT_INVALID_FRAMEWORK,
  cliErrors.INIT_INVALID_ENRICHER,
  cliErrors.INIT_INVALID_SAMPLING,
  cliErrors.INIT_INVALID_DRAIN,
  cliErrors.INIT_INVALID_EXTRA,
  cliErrors.INIT_NO_APPS,
  cliErrors.AGENTS_INVALID_SOURCE,
  cliErrors.AGENTS_INVALID_SKILL,
  cliErrors.LOGS_INVALID_TIME,
  cliErrors.LOGS_INVALID_LEVEL,
  cliErrors.LOGS_INVALID_STATUS,
  cliErrors.LOGS_INVALID_DURATION,
  cliErrors.LOGS_INVALID_WHERE,
  cliErrors.LOGS_INVALID_LIMIT,
  cliErrors.LOGS_INVALID_SOURCE,
  cliErrors.LOGS_SOURCE_CONFLICT,
  cliErrors.SETUP_INVALID_TARGET,
  cliErrors.SETUP_INVALID_ENVIRONMENT,
  cliErrors.SETUP_INVALID_CONNECTOR,
  cliErrors.SETUP_VERCEL_NO_CONNECTOR,
  cliErrors.LOGS_ASK_UNSUPPORTED,
].map(entry => entry.code))

/**
 * Whether an error is a usage error, which exits 2 where a failed check exits 1:
 * the project did not fail anything, the invocation could not be read.
 */
export function isUsageError(error: { code?: string }): boolean {
  return error.code !== undefined && USAGE_ERRORS.has(error.code)
}

declare module 'evlog' {
  interface RegisteredErrorCatalogs {
    cli: typeof cliErrors
  }
}
