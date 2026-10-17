import { access, readFile, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { collectEvlogPackages } from './map/evlog-packages'

/** Minimal `package.json` fields used for project / workspace discovery. */
export interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
}

/** How the project is laid out — plain package or a detected workspace tool. */
export type WorkspaceKind = 'single' | 'pnpm' | 'npm' | 'yarn' | 'bun'

/** Resolved project layout for the directory the user ran from. */
export interface ProjectInfo {
  /** Directory the user ran from (or `--cwd`). */
  cwd: string
  /** Nearest package.json directory (may equal cwd). */
  packageDir: string
  /** Workspace / project root (pnpm-workspace, workspaces field, or packageDir). */
  root: string
  kind: WorkspaceKind
  packageName: string | null
  packageJson: PackageJson | null
}

/** Resolved `evlog` install discovered under the project (version + paths). */
export interface EvlogInstall {
  version: string
  /** Absolute path to the resolved `evlog` package root. */
  path: string
  /** Where it was declared, if found (`dependencies` / `devDependencies`). */
  declaredIn: string | null
  declaredRange: string | null
}

/** One probe while resolving `evlog` from the filesystem / require graph. */
export interface ResolveAttempt {
  base: string
  method: 'require' | 'fs'
  ok: boolean
  path?: string
  error?: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Deduplicate path list while preserving order. */
function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)]
}

/** Read and parse a JSON file; `null` on missing / invalid. */
export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T
  } catch {
    return null
  }
}

async function detectWorkspaceKind(dir: string, pkg: PackageJson | null): Promise<WorkspaceKind | null> {
  if (await exists(join(dir, 'pnpm-workspace.yaml'))) return 'pnpm'
  if (!pkg?.workspaces) return null
  // Bun uses the npm `workspaces` field; distinguish via lockfile.
  if (await exists(join(dir, 'bun.lock')) || await exists(join(dir, 'bun.lockb'))) return 'bun'
  if (await exists(join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

/**
 * Walk up from `start` to locate the nearest package and the workspace root.
 * Handles pnpm / bun / npm / yarn workspaces and plain single packages.
 */
export async function resolveProject(start: string): Promise<ProjectInfo> {
  const cwd = resolve(start)
  let packageDir: string | null = null
  let packageJson: PackageJson | null = null
  let root = cwd
  let kind: WorkspaceKind = 'single'

  let dir = cwd
  for (;;) {
    const pkgPath = join(dir, 'package.json')
    if (await exists(pkgPath)) {
      const pkg = await readJson<PackageJson>(pkgPath)
      if (!packageDir) {
        packageDir = dir
        packageJson = pkg
        // Single-package default: root is the nearest package, not a parent.
        root = dir
      }
      const detected = await detectWorkspaceKind(dir, pkg)
      if (detected) {
        root = dir
        kind = detected
        break
      }
      // Keep walking — a parent may still be a workspace root.
    }

    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  if (!packageDir) {
    return {
      cwd,
      packageDir: cwd,
      root: cwd,
      kind: 'single',
      packageName: null,
      packageJson: null,
    }
  }

  return {
    cwd,
    packageDir,
    root,
    kind,
    packageName: packageJson?.name ?? null,
    packageJson,
  }
}

function declaredEvlog(pkg: PackageJson | null): { range: string, field: string } | null {
  if (!pkg) return null
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const range = pkg[field]?.evlog
    if (range) return { range, field }
  }
  return null
}

/** How this project reaches evlog: its own install, and any wrapper package that forwards it. */
export interface EvlogResolution {
  install: EvlogInstall | null
  declared: { range: string, field: string } | null
  tried: ResolveAttempt[]
  /**
   * Dependencies that declare evlog and forward its names (`@acme/logger` calling
   * `createEvlog`), keyed by package name. An app that imports only such a wrapper
   * still has evlog; `map`, `doctor` and `init` all read `hasEvlog` from here.
   */
  wrappers: ReadonlyMap<string, ReadonlySet<string>>
}

/**
 * The one answer to "does this project have evlog?", shared by `map`, `doctor`
 * and `init`: evlog's own install, plus the wrapper packages that forward it.
 */
export async function resolveEvlog(project: ProjectInfo): Promise<EvlogResolution> {
  const own = await findEvlogInstall(project)
  const pkg = project.packageJson
  const dependencies = new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
  ])
  return { ...own, wrappers: collectEvlogPackages(project.packageDir, dependencies) }
}

/** True when the project reaches evlog, directly or through a wrapper package. */
export function evlogReached(resolution: EvlogResolution): boolean {
  return resolution.install !== null || resolution.wrappers.size > 0
}

/**
 * Resolve an installed `evlog` package by walking `node_modules` (hoist-aware)
 * via `createRequire`, then fall back to declared ranges in the local package.json.
 *
 * `tried` lists every probe (for `--debug` decision trails).
 */
async function findEvlogInstall(project: ProjectInfo): Promise<{
  install: EvlogInstall | null
  declared: { range: string, field: string } | null
  tried: ResolveAttempt[]
}> {
  const declared = declaredEvlog(project.packageJson)
  const tried: ResolveAttempt[] = []

  // packageDir / root / cwd often collapse to the same path (e.g. bare /tmp)
  const candidates = uniquePaths([project.packageDir, project.root, project.cwd])
  for (const base of candidates) {
    const pkgJsonPath = join(base, 'package.json')
    if (!(await exists(pkgJsonPath))) {
      tried.push({ base, method: 'require', ok: false, error: 'no package.json' })
      continue
    }
    try {
      const require = createRequire(pkgJsonPath)
      const resolved = require.resolve('evlog/package.json')
      const meta = await readJson<{ version?: string }>(resolved)
      if (meta?.version) {
        const path = dirname(resolved)
        tried.push({ base, method: 'require', ok: true, path })
        return {
          install: {
            version: meta.version,
            path,
            declaredIn: declared ? project.packageDir : null,
            declaredRange: declared?.range ?? null,
          },
          declared,
          tried,
        }
      }
      tried.push({ base, method: 'require', ok: false, error: 'package.json missing version' })
    } catch (error) {
      tried.push({
        base,
        method: 'require',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Direct filesystem probe (no package.json at base, or createRequire failed)
  for (const base of candidates) {
    const direct = join(base, 'node_modules', 'evlog', 'package.json')
    const meta = await readJson<{ version?: string }>(direct)
    if (meta?.version) {
      const path = dirname(direct)
      tried.push({ base, method: 'fs', ok: true, path })
      return {
        install: {
          version: meta.version,
          path,
          declaredIn: declared ? project.packageDir : null,
          declaredRange: declared?.range ?? null,
        },
        declared,
        tried,
      }
    }
    tried.push({ base, method: 'fs', ok: false, error: 'not found' })
  }

  return { install: null, declared, tried }
}

/** Relative path for display; `.` when identical. */
export function prettyPath(from: string, to: string): string {
  const rel = relative(from, to)
  if (!rel) return '.'
  return rel.split(sep).join('/')
}

/**
 * Locate a readable `.evlog/logs` sink — prefers cwd, then package dir, then root.
 */
export async function findLogsSink(project: ProjectInfo): Promise<{
  dir: string
  files: number
} | null> {
  for (const base of uniquePaths([project.cwd, project.packageDir, project.root])) {
    const dir = join(base, '.evlog', 'logs')
    try {
      await stat(dir)
      const entries = await readdir(dir)
      return { dir, files: entries.filter(f => f.endsWith('.jsonl')).length }
    } catch {
      // try next
    }
  }
  return null
}

/** The fs drain's default directory, used when no env override names another. */
const DEFAULT_FS_DIR = '.evlog/logs'

/**
 * Whether the project declares an fs drain. The drain creates its directory
 * lazily on first write, so a declared drain is a sink even before any event,
 * and a project without one is not expected to have a local sink at all.
 */
export async function findConfiguredFsDrain(
  project: ProjectInfo,
  env: Record<string, string | undefined>,
): Promise<{ dir: string } | null> {
  const envDir = env.EVLOG_FS_DIR ?? env.NUXT_EVLOG_FS_DIR
  if (envDir) return { dir: envDir }

  for (const base of uniquePaths([project.cwd, project.packageDir, project.root])) {
    if (await dirWiresFsDrain(join(base, 'server', 'plugins'))) return { dir: DEFAULT_FS_DIR }
    if (await fileWiresFsDrain(join(base, 'lib', 'evlog.ts'))) return { dir: DEFAULT_FS_DIR }
    if (await fileWiresFsDrain(join(base, 'src', 'lib', 'evlog.ts'))) return { dir: DEFAULT_FS_DIR }
  }
  return null
}

async function dirWiresFsDrain(dir: string): Promise<boolean> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return false
  }
  for (const entry of entries) {
    if (!/\.(ts|mts|js|mjs)$/.test(entry)) continue
    if (await fileWiresFsDrain(join(dir, entry))) return true
  }
  return false
}

async function fileWiresFsDrain(path: string): Promise<boolean> {
  try {
    return (await readFile(path, 'utf8')).includes('createFsDrain')
  } catch {
    return false
  }
}

/** Framework / integration hints based on package.json dependencies. */
export function detectStack(pkg: PackageJson | null): string[] {
  if (!pkg) return []
  const all = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }
  const hits: string[] = []
  const probes: [string, string][] = [
    ['nuxt', 'nuxt'],
    ['next', 'next'],
    ['nitro', 'nitropack'],
    ['hono', 'hono'],
    ['express', 'express'],
    ['fastify', 'fastify'],
    ['@sveltejs/kit', 'sveltekit'],
    ['@evlog/nuxthub', 'nuxthub'],
    ['@evlog/telemetry', 'telemetry'],
  ]
  for (const [dep, label] of probes) {
    if (all[dep]) hits.push(label)
  }
  return hits
}
