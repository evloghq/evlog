import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { VERSION } from '../constants'
import { cliErrors } from '../errors'
import { glob } from '../glob'
import { resolveEvlog, resolveProject } from '../project'
import { migrate } from './engine'
import type { MigrateResult } from './engine'
import { MIGRATIONS } from './migrations'
import type { Migration, UpgradeFinding } from './types'
import { startingMajor } from './version'

/** Bump when a field of {@link UpgradeReport} changes meaning or goes away. */
export const UPGRADE_SCHEMA_VERSION = 1

const CODE_PATTERNS = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue}']

/** What `evlog upgrade --json` prints. */
export interface UpgradeReport {
  schemaVersion: typeof UPGRADE_SCHEMA_VERSION
  /** The evlog major the project was on. */
  from: number
  /** The major it is (or would be) on after this run. Equal to `from` when there was nothing to do. */
  to: number
  write: boolean
  findings: Array<Omit<UpgradeFinding, 'edits'> & { fixed: boolean }>
  /** Files changed (`write`) or that would change. */
  files: string[]
  summary: { auto: number, report: number }
}

export interface UpgradeInput {
  cwd: string
  write: boolean
  force: boolean
  /** Defaults to every migration the CLI ships. */
  migrations?: readonly Migration[]
  /** Defaults to whether this CLI is a prerelease. */
  prerelease?: boolean
}

/**
 * Read the project, run the migrations above its evlog major and, with
 * `write`, save the result. Throws catalog errors the command renders.
 */
export async function runUpgrade(input: UpgradeInput): Promise<{ report: UpgradeReport, result: MigrateResult }> {
  const project = await resolveProject(input.cwd)
  if (!project.packageJson) throw cliErrors.UPGRADE_NO_PACKAGE_JSON()
  const root = project.packageDir
  const evlog = await resolveEvlog(project)
  const from = startingMajor(project.packageJson as Record<string, unknown>, evlog.install?.version)
  if (from === null) throw cliErrors.UPGRADE_NO_EVLOG()
  if (input.write && !input.force && hasUncommittedChanges(root)) throw cliErrors.UPGRADE_DIRTY_TREE()

  const files = new Map<string, string>()
  for (const path of glob(CODE_PATTERNS, root)) files.set(toPosix(relative(root, path)), readFileSync(path, 'utf8'))

  const result = migrate({
    files,
    packageJson: { file: 'package.json', source: readFileSync(join(root, 'package.json'), 'utf8') },
    migrations: input.migrations ?? MIGRATIONS,
    from,
    prerelease: input.prerelease ?? VERSION.includes('-'),
  })

  if (input.write) {
    for (const [file, steps] of result.files) {
      const last = steps.at(-1)!
      if (last.after !== steps[0]!.before) writeFileSync(join(root, file), last.after)
    }
  }

  const findings = result.findings.map(({ edits: _edits, ...finding }) => ({ ...finding, fixed: input.write && finding.mode === 'auto' }))
  return {
    result,
    report: {
      schemaVersion: UPGRADE_SCHEMA_VERSION,
      from,
      to: result.to,
      write: input.write,
      findings,
      files: [...result.files].filter(([, steps]) => steps.at(-1)!.after !== steps[0]!.before).map(([file]) => file),
      summary: {
        auto: findings.filter(finding => finding.mode === 'auto').length,
        report: findings.filter(finding => finding.mode === 'report').length,
      },
    },
  }
}

/**
 * Whether the project directory has uncommitted changes. Outside a git
 * repository, or without git, there is nothing to protect and this is false.
 */
function hasUncommittedChanges(root: string): boolean {
  try {
    return execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0
  } catch {
    return false
  }
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}
