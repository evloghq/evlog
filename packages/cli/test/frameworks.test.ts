import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderBlock } from '../src/lib/agents/block'
import { cliErrors } from '../src/lib/errors'
import { FRAMEWORKS, FRAMEWORK_IDS, INIT_FRAMEWORK_IDS, getFramework, isFramework, isInitFramework } from '../src/lib/frameworks'
import { detectFramework } from '../src/lib/map/detect'
import { resolveProject } from '../src/lib/project'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('framework registry', () => {
  it('has unique ids and labels', () => {
    expect(new Set(FRAMEWORK_IDS).size).toBe(FRAMEWORKS.length)
    expect(new Set(FRAMEWORKS.map(f => f.label)).size).toBe(FRAMEWORKS.length)
  })

  it.each(FRAMEWORK_IDS)('loads a map adapter for %s', async (id) => {
    const adapter = await getFramework(id).map()
    expect(typeof adapter.extractRoutes).toBe('function')
  })

  it.each(INIT_FRAMEWORK_IDS)('loads an init planner for %s', async (id) => {
    expect(typeof await getFramework(id).init!()).toBe('function')
  })

  it.each(FRAMEWORK_IDS)('detects %s from its first declared dependency', async (id) => {
    const dir = await mkdtemp(join(tmpdir(), 'evlog-cli-frameworks-'))
    tempDirs.push(dir)
    const dep = getFramework(id).detect.deps[0]!
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { [dep]: '*' } }))
    expect(detectFramework(await resolveProject(dir)).framework).toBe(id)
  })

  it('narrows user input to known ids', () => {
    expect(isFramework('hono')).toBe(true)
    expect(isFramework('koa')).toBe(false)
    expect(isInitFramework('next')).toBe(true)
    expect(isInitFramework('koa')).toBe(false)
  })

  it('names every init framework in the --framework error fix', () => {
    const { fix } = cliErrors.INIT_INVALID_FRAMEWORK({ value: 'koa' })
    for (const id of INIT_FRAMEWORK_IDS) expect(fix).toContain(id)
  })

  it('writes the registry accessor into the AGENTS.md block', () => {
    expect(renderBlock({ framework: 'hono', hasSkills: false })).toContain(getFramework('hono').accessor)
  })
})
