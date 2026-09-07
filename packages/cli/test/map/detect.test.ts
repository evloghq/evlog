import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectFramework } from '../../src/lib/map/detect'
import { resolveProject } from '../../src/lib/project'

const tempDirs: string[] = []

async function makeProject(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'evlog-cli-map-detect-'))
  tempDirs.push(dir)
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, contents, 'utf-8')
  }
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('detectFramework', () => {
  it('honors an explicit --framework override without reading package.json', async () => {
    const project = await resolveProject(await makeProject())
    expect(detectFramework(project, 'next')).toEqual({ framework: 'next', warnings: [] })
  })

  it('throws MAP_NO_PACKAGE_JSON when no package.json is found', async () => {
    const project = await resolveProject(await makeProject())
    expect(() => detectFramework(project)).toThrowError(/no package\.json/i)
  })

  it('throws MAP_WORKSPACE_ROOT when run from a bare monorepo root', async () => {
    const root = await makeProject({
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      'package.json': JSON.stringify({ name: 'monorepo', private: true }),
    })
    const project = await resolveProject(root)
    expect(() => detectFramework(project)).toThrowError(/monorepo root/i)
  })

  it('detects express from a dependency', async () => {
    const dir = await makeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { express: '^5.0.0' } }),
    })
    const project = await resolveProject(dir)
    expect(detectFramework(project).framework).toBe('express')
  })

  it('detects fastify from a dependency', async () => {
    const dir = await makeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { fastify: '^5.0.0' } }),
    })
    const project = await resolveProject(dir)
    expect(detectFramework(project).framework).toBe('fastify')
  })

  it('detects elysia from a dependency', async () => {
    const dir = await makeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { elysia: '^1.0.0' } }),
    })
    const project = await resolveProject(dir)
    expect(detectFramework(project).framework).toBe('elysia')
  })

  it('throws MAP_FRAMEWORK_NOT_DETECTED for an unsupported single-package project', async () => {
    const dir = await makeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { koa: '^3.0.0' } }),
    })
    const project = await resolveProject(dir)
    expect(() => detectFramework(project)).toThrowError(/could not detect a supported framework/i)
  })

  it('picks nuxt over nitro when both dependencies are present', async () => {
    const dir = await makeProject({
      'package.json': JSON.stringify({ name: 'app', dependencies: { nuxt: '^3.0.0', nitropack: '^2.0.0' } }),
    })
    const project = await resolveProject(dir)
    expect(detectFramework(project).framework).toBe('nuxt')
  })
})
