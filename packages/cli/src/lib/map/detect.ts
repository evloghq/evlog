import { globSync } from 'tinyglobby'
import { cliErrors } from '../errors'
import type { ProjectInfo } from '../project'
import type { Framework } from './types'

interface DetectionMatch {
  framework: Framework
  specificity: number
  reason: string
}

export interface DetectionResult {
  framework: Framework
  warnings: string[]
}

function hasDep(pkg: ProjectInfo['packageJson'], names: string[]): boolean {
  if (!pkg) return false
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  return names.some(n => n in deps)
}

function hasConfig(root: string, patterns: string[]): boolean {
  return globSync(patterns, { cwd: root, absolute: false }).length > 0
}

/**
 * Pick a {@link Framework} for `map`'s adapter dispatch — dependency + config
 * probes, most specific match wins. Throws a catalog {@link cliErrors} error
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
  const matches: DetectionMatch[] = []

  if (hasDep(pkg, ['nuxt']) || hasConfig(root, ['nuxt.config.{ts,js,mjs}'])) {
    matches.push({ framework: 'nuxt', specificity: 10, reason: 'nuxt dependency or nuxt.config' })
  }

  if (
    (hasDep(pkg, ['nitropack', 'nitro']) || hasConfig(root, ['nitro.config.{ts,js,mjs}']))
    && !hasDep(pkg, ['nuxt'])
  ) {
    matches.push({ framework: 'nitro', specificity: 8, reason: 'nitro dependency or nitro.config' })
  }

  if (hasDep(pkg, ['next']) || hasConfig(root, ['next.config.{ts,js,mjs}'])) {
    matches.push({ framework: 'next', specificity: 10, reason: 'next dependency or next.config' })
  }

  if (hasDep(pkg, ['@tanstack/react-start', '@tanstack/start'])) {
    matches.push({ framework: 'tanstack-start', specificity: 10, reason: '@tanstack/react-start dependency' })
  }

  if (hasDep(pkg, ['hono'])) {
    matches.push({ framework: 'hono', specificity: 10, reason: 'hono dependency' })
  }

  if (hasDep(pkg, ['express'])) {
    matches.push({ framework: 'express', specificity: 10, reason: 'express dependency' })
  }

  if (hasDep(pkg, ['fastify'])) {
    matches.push({ framework: 'fastify', specificity: 10, reason: 'fastify dependency' })
  }

  if (hasDep(pkg, ['elysia'])) {
    matches.push({ framework: 'elysia', specificity: 10, reason: 'elysia dependency' })
  }

  if (matches.length === 0) {
    const isBareWorkspaceRoot = project.kind !== 'single' && project.packageDir === project.root
    if (isBareWorkspaceRoot) {
      throw cliErrors.MAP_WORKSPACE_ROOT()
    }
    throw cliErrors.MAP_FRAMEWORK_NOT_DETECTED()
  }

  matches.sort((a, b) => b.specificity - a.specificity)
  const best = matches[0]!
  const warnings: string[] = []

  if (matches.length > 1) {
    const others = matches.slice(1).map(m => m.framework).join(', ')
    warnings.push(`Multiple frameworks detected; using ${best.framework} (${others} also matched)`)
  }

  return { framework: best.framework, warnings }
}
