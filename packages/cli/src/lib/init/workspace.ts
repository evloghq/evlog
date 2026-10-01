import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { globSync } from 'tinyglobby'
import { detectFramework } from '../map/detect'
import type { Framework } from '../map/types'
import type { PackageJson, ProjectInfo } from '../project'
import { isInitFramework } from '../frameworks'

/** A workspace package `init` could set up. */
export interface WorkspaceApp {
  name: string
  /** Absolute package directory. */
  dir: string
  /** Path as the user would type it — `apps/web`. */
  label: string
  framework: Framework
}

/** Whether this looks like a workspace root rather than an app. */
export function isWorkspaceRoot(project: ProjectInfo): boolean {
  return project.kind !== 'single' && project.packageDir === project.root
}

/**
 * Find the apps in a workspace that `init` knows how to wire.
 *
 * Packages with no detectable framework are left out — a shared `utils`
 * package has no entry points to instrument. So are map-only frameworks,
 * which init has no wiring plan for.
 */
export function findWorkspaceApps(project: ProjectInfo): WorkspaceApp[] {
  const patterns = workspaceGlobs(project)
  if (patterns.length === 0) return []

  const manifests = globSync(patterns.map(pattern => `${pattern}/package.json`), {
    cwd: project.root,
    absolute: true,
    ignore: ['**/node_modules/**'],
  })

  const apps: WorkspaceApp[] = []
  for (const manifest of manifests) {
    const dir = dirname(manifest)
    if (dir === project.root) continue

    let packageJson: PackageJson | null
    try {
      packageJson = JSON.parse(readFileSync(manifest, 'utf8')) as PackageJson
    } catch {
      continue
    }

    const candidate: ProjectInfo = {
      cwd: dir,
      packageDir: dir,
      root: project.root,
      kind: project.kind,
      packageName: packageJson.name ?? null,
      packageJson,
    }

    try {
      const { framework } = detectFramework(candidate)
      if (!isInitFramework(framework)) continue
      apps.push({
        name: packageJson.name ?? relative(project.root, dir),
        dir,
        label: relative(project.root, dir),
        framework,
      })
    } catch {
      // No framework, nothing to instrument.
    }
  }

  return apps.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
}

function workspaceGlobs(project: ProjectInfo): string[] {
  if (project.kind === 'pnpm') {
    try {
      const yaml = readFileSync(join(project.root, 'pnpm-workspace.yaml'), 'utf8')
      return parsePnpmPackages(yaml)
    } catch {
      return []
    }
  }

  const workspaces = project.packageJson?.workspaces
  if (Array.isArray(workspaces)) return workspaces
  if (workspaces?.packages) return workspaces.packages
  return []
}

/**
 * Read the `packages:` list out of `pnpm-workspace.yaml`.
 *
 * Negated globs are dropped: tinyglobby takes them as patterns rather than
 * exclusions, so keeping them would search for a directory named `!docs`.
 */
export function parsePnpmPackages(yaml: string): string[] {
  const patterns: string[] = []
  let inside = false

  for (const raw of yaml.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd()
    if (/^packages:\s*$/.test(line)) {
      inside = true
      continue
    }
    if (inside) {
      const entry = line.match(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/)
      if (entry?.[1]) {
        if (!entry[1].startsWith('!')) patterns.push(entry[1])
        continue
      }
      if (line.trim().length > 0) break
    }
  }

  return patterns
}
