import { globSync } from 'tinyglobby'
import { cliErrors } from '../errors'
import { FRAMEWORKS } from '../frameworks'
import type { FrameworkDetection } from '../frameworks'
import type { ProjectInfo } from '../project'
import type { Framework } from './types'

export interface DetectionResult {
  framework: Framework
  warnings: string[]
}

function hasDep(pkg: NonNullable<ProjectInfo['packageJson']>, names: readonly string[]): boolean {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  return names.some(n => n in deps)
}

function hasConfig(root: string, patterns: readonly string[]): boolean {
  return globSync([...patterns], { cwd: root, absolute: false }).length > 0
}

function matches(detect: FrameworkDetection, root: string, pkg: NonNullable<ProjectInfo['packageJson']>): boolean {
  if (detect.unlessDeps && hasDep(pkg, detect.unlessDeps)) return false
  return hasDep(pkg, detect.deps) || (!!detect.configs && hasConfig(root, detect.configs))
}

/**
 * Pick a {@link Framework} from the probes declared in the framework registry,
 * most specific match wins. Throws a catalog {@link cliErrors} error
 * (`--framework` to override) when nothing matches, distinguishing a bare
 * monorepo root (via {@link ProjectInfo}) from a genuinely unsupported stack.
 */
export function detectFramework(project: ProjectInfo, override?: Framework): DetectionResult {
  if (override) {
    return { framework: override, warnings: [] }
  }

  if (!project.packageJson) {
    throw cliErrors.MAP_NO_PACKAGE_JSON()
  }

  const root = project.packageDir
  const pkg = project.packageJson
  const found = FRAMEWORKS
    .filter(definition => matches(definition.detect, root, pkg))
    .sort((a, b) => b.detect.specificity - a.detect.specificity)

  if (found.length === 0) {
    const isBareWorkspaceRoot = project.kind !== 'single' && project.packageDir === project.root
    if (isBareWorkspaceRoot) {
      throw cliErrors.MAP_WORKSPACE_ROOT()
    }
    throw cliErrors.MAP_FRAMEWORK_NOT_DETECTED()
  }

  const best = found[0]!
  const warnings: string[] = []

  if (found.length > 1) {
    const others = found.slice(1).map(m => m.id).join(', ')
    warnings.push(`Multiple frameworks detected; using ${best.id} (${others} also matched)`)
  }

  return { framework: best.id, warnings }
}
