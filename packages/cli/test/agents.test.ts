import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createContext } from '../src/core/context'
import type { CliContext } from '../src/core/context'
import { MARKER_END, MARKER_START, renderBlock, upsertBlock } from '../src/lib/agents/block'
import { planAgents } from '../src/lib/agents/plan'
import { formatAgentsReport } from '../src/lib/agents/report'
import { agentsTelemetryFieldNames, runAgents } from '../src/lib/agents/run'
import { EVLOG_SKILLS, findInstalledSkills, skillsCommand } from '../src/lib/agents/skills'

/**
 * Only the spawn is faked; everything else in the module stays real.
 *
 * Set `spawnResult` to drive the one branch a test cannot reach for real —
 * actually shelling out to `npx` in a unit test is neither fast nor honest.
 */
const skills = vi.hoisted(() => ({
  spawnResult: null as null | { ok: true } | { ok: false, error: string },
  calls: 0,
}))

vi.mock('../src/lib/agents/skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/agents/skills')>()
  return {
    ...actual,
    runSkills: (...args: Parameters<typeof actual.runSkills>) => {
      skills.calls += 1
      return skills.spawnResult ? Promise.resolve(skills.spawnResult) : actual.runSkills(...args)
    },
  }
})

const tempDirs: string[] = []

async function project(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'evlog-cli-agents-'))
  tempDirs.push(dir)
  for (const [path, contents] of Object.entries(files)) {
    const target = join(dir, path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, contents, 'utf8')
  }
  return dir
}

/**
 * An empty home, so a run is judged on the project rather than on whatever the
 * machine executing the suite happens to have installed globally.
 */
function fakeContext(cwd: string, home = join(cwd, '__home')): CliContext {
  return createContext({ cwd, home, env: {}, nodeVersion: 'v22.0.0', tty: false, color: false, columns: 80 })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  skills.spawnResult = null
  skills.calls = 0
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('renderBlock', () => {
  it('wraps the guidance in the markers', () => {
    const block = renderBlock({ framework: 'nuxt', hasSkills: false })

    expect(block.startsWith(MARKER_START)).toBe(true)
    expect(block.trimEnd().endsWith(MARKER_END)).toBe(true)
  })

  it('names the framework-native accessor', () => {
    expect(renderBlock({ framework: 'nuxt', hasSkills: false })).toContain('useLogger(event)')
    expect(renderBlock({ framework: 'tanstack-start', hasSkills: false })).toContain('req.context.log')
    expect(renderBlock({ framework: 'next', hasSkills: false })).toContain('lib/evlog.ts')
  })

  it('falls back to a generic accessor when detection found nothing', () => {
    expect(renderBlock({ framework: null, hasSkills: false })).toContain('`useLogger()` inside a request handler')
  })

  it('names the skill but never the directory it landed in', () => {
    /* Every agent reads a different path, so naming one would be wrong for the
       rest — the skills CLI decides where they go. */
    const block = renderBlock({ framework: 'nuxt', hasSkills: true })

    expect(block).toContain('review-logging-patterns')
    expect(block).not.toContain('.agents/skills')
    expect(block).not.toContain('.claude/skills')
  })
})

describe('upsertBlock', () => {
  it('replaces the block and leaves everything around it alone', () => {
    const source = `# shop\n\nOur rules.\n\n${MARKER_START}\nold\n${MARKER_END}\n\nMore rules.\n`

    const next = upsertBlock(source, `${MARKER_START}\nnew\n${MARKER_END}\n`)

    expect(next).toBe(`# shop\n\nOur rules.\n\n${MARKER_START}\nnew\n${MARKER_END}\n\nMore rules.\n`)
  })

  it('returns null when the block is already exactly this', () => {
    const block = `${MARKER_START}\nsame\n${MARKER_END}\n`

    expect(upsertBlock(`# shop\n\n${block.trimEnd()}\n`, block)).toBeNull()
  })

  it('appends when there are no markers yet', () => {
    const next = upsertBlock('# shop\n\nOur rules.\n', `${MARKER_START}\nnew\n${MARKER_END}\n`)

    expect(next).toBe(`# shop\n\nOur rules.\n\n${MARKER_START}\nnew\n${MARKER_END}\n`)
  })
})

describe('findInstalledSkills', () => {
  /* Owned by the suite rather than a fixed temp path: a stray
     `evlog-cli-agents-no-home/.claude/skills/<name>` on the build machine would
     otherwise silently change what these assertions mean. */
  let NO_HOME: string
  beforeEach(async () => {
    NO_HOME = await project()
  })

  it('finds a skill in any agent directory', async () => {
    const root = await project({ '.claude/skills/review-logging-patterns/SKILL.md': '# x\n' })

    expect(findInstalledSkills(root, NO_HOME)).toMatchObject({
      names: ['review-logging-patterns'],
      dirs: ['.claude/skills'],
    })
  })

  it('collects the same skill installed for several agents', async () => {
    const root = await project({
      '.claude/skills/analyze-logs/SKILL.md': '# x\n',
      '.cursor/skills/analyze-logs/SKILL.md': '# x\n',
    })

    expect(findInstalledSkills(root, NO_HOME).dirs).toEqual(['.claude/skills', '.cursor/skills'])
  })

  it('ignores a directory that is not one of ours', async () => {
    const root = await project({ '.claude/skills/something-else/SKILL.md': '# x\n' })

    expect(findInstalledSkills(root, NO_HOME).names).toEqual([])
  })

  it('finds a globally installed skill and marks the scope', async () => {
    /* Somebody who ran `npx skills add -g` months ago must not be told to
       install again in every project they open. */
    const home = await project({ '.claude/skills/analyze-logs/SKILL.md': '# x\n' })
    const root = await project({ 'package.json': '{}' })

    expect(findInstalledSkills(root, home)).toMatchObject({
      names: ['analyze-logs'],
      dirs: ['~/.claude/skills'],
    })
  })

  it('knows every published skill', () => {
    expect([...EVLOG_SKILLS].sort()).toEqual(['analyze-logs', 'build-audit-logs', 'review-logging-patterns'])
  })
})

describe('skillsCommand', () => {
  it('adds every published skill from the docs site, globally, by default', () => {
    expect(skillsCommand({ interactive: true }).display).toBe('npx --yes skills add https://www.evlog.dev --agent universal --agent claude-code --global')
  })

  it('shows the command it actually runs, argument for argument', () => {
    /* The plan prints this and the report says to re-run it, so a tidied
       version that drops npx's own --yes would not reproduce the run. */
    const command = skillsCommand({ interactive: false })

    expect(command.display).toBe(`${command.bin} ${command.args.join(' ')}`)
  })

  it('lets the skills CLI ask its own questions when somebody is watching', () => {
    /* Which agents to install for is its question, not ours — so the trailing
       --yes, the one aimed at the skills CLI, appears only when nobody can
       answer. The leading one is npx's and is always there. */
    expect(skillsCommand({ interactive: true }).display)
      .toBe('npx --yes skills add https://www.evlog.dev --agent universal --agent claude-code --global')
    expect(skillsCommand({ interactive: false }).display)
      .toBe('npx --yes skills add https://www.evlog.dev --agent universal --agent claude-code --global --yes')
  })

  it('passes the skill selection through', () => {
    const command = skillsCommand({ interactive: true, skills: ['analyze-logs'] })

    expect(command.display).toBe('npx --yes skills add https://www.evlog.dev --skill analyze-logs --agent universal --agent claude-code --global')
  })

  it('installs into the project only with local, and leaves out --global', () => {
    expect(skillsCommand({ interactive: true, local: true }).display)
      .toBe('npx --yes skills add https://www.evlog.dev --agent universal --agent claude-code')
  })

  it('targets universal and claude-code, not every detected agent', () => {
    /* `universal` is the shared .agents/skills directory that Codex reads, and
       claude-code gets a symlink into it. cursor would be a second copy. */
    const { args } = skillsCommand({ interactive: true })

    expect(args.filter(arg => arg === '--agent')).toHaveLength(2)
    expect(args).toContain('universal')
    expect(args).toContain('claude-code')
    expect(args).not.toContain('cursor')
    expect(args).not.toContain('codex')
  })

  it('runs npx rather than depending on the package', () => {
    expect(skillsCommand({ interactive: true }).bin).toBe('npx')
  })

  it('rejects a source that is not an http(s) URL', () => {
    for (const source of ['file:///etc/passwd', 'not a url', '']) {
      expect(() => skillsCommand({ interactive: true, source }), source)
        .toThrowError(expect.objectContaining({ code: 'cli.AGENTS_INVALID_SOURCE' }))
    }
  })

  it('rejects shell metacharacters even inside a valid URL', () => {
    /* Being an http(s) URL is not enough: `?q=1&calc` parses, and on Windows
       the spawn needs a shell, where `&` starts a second command. */
    for (const source of [
      'https://evlog.dev?q=1&calc',
      'https://evlog.dev && calc',
      'https://evlog.dev|calc',
      'https://evlog.dev;calc',
      'https://evlog.dev/%TEMP%',
      'https://evlog.dev/$(calc)',
    ]) {
      expect(() => skillsCommand({ interactive: true, source }), source)
        .toThrowError(expect.objectContaining({ code: 'cli.AGENTS_INVALID_SOURCE' }))
    }
  })

  it('rejects a skill name that is not a plain identifier', () => {
    for (const skill of ['analyze logs', 'a&&b', '../escape', 'UPPER']) {
      expect(() => skillsCommand({ interactive: true, skills: [skill] }), skill)
        .toThrowError(expect.objectContaining({ code: 'cli.AGENTS_INVALID_SKILL' }))
    }
  })

  it('accepts a self-hosted origin', () => {
    expect(skillsCommand({ interactive: true, source: 'http://localhost:3000' }).display)
      .toBe('npx --yes skills add http://localhost:3000 --agent universal --agent claude-code --global')
  })
})

describe('planAgents', () => {
  it('creates AGENTS.md in a project that has none', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const plan = planAgents({ root, projectName: 'shop', framework: 'nuxt', hasSkills: false })

    expect(plan.actions.map(action => action.relative)).toEqual(['AGENTS.md'])
    expect(plan.actions.every(action => action.kind === 'create')).toBe(true)
    expect(plan.actions[0]!.contents).toContain('# shop')
  })

  it('plans no skill files — they are not ours to write', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const plan = planAgents({ root, projectName: 'shop', framework: 'nuxt', hasSkills: true })

    expect(plan.actions.every(action => !action.relative.includes('skills'))).toBe(true)
  })
})

describe('agents telemetry fields', () => {
  it('never names a field that could carry a path or a project name', () => {
    for (const name of agentsTelemetryFieldNames()) {
      expect(name).toMatch(/^agents[A-Z]/)
      expect(name.toLowerCase()).not.toContain('name')
      expect(name.toLowerCase()).not.toContain('path')
    }
  })

  it('keeps the field names distinct', () => {
    const names = agentsTelemetryFieldNames()

    expect(new Set(names).size).toBe(names.length)
  })
})

describe('runAgents', () => {
  it('writes the block and nothing else, and reports the skills it skipped', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const result = await runAgents(fakeContext(root), undefined, { noSkills: true })

    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain(MARKER_START)
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false)
    expect(result.skills).toMatchObject({ status: 'skipped', command: 'npx --yes skills add https://www.evlog.dev --agent universal --agent claude-code --global --yes' })
  })

  it('never touches an existing CLAUDE.md', async () => {
    /* Claude Code reads AGENTS.md when no CLAUDE.md sits above it, so a file
       someone wrote is theirs to keep. We neither edit it nor add a pointer. */
    const root = await project({ 'package.json': '{"name":"shop"}', 'CLAUDE.md': '# Mine\n' })

    await runAgents(fakeContext(root), undefined, { noSkills: true })

    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe('# Mine\n')
  })

  it('is safe to run twice — the second run changes nothing', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    await runAgents(fakeContext(root), undefined, { noSkills: true })
    const first = await readFile(join(root, 'AGENTS.md'), 'utf8')

    const second = await runAgents(fakeContext(root), undefined, { noSkills: true })

    expect(second.written).toHaveLength(0)
    expect(second.already).toEqual(['AGENTS.md is up to date'])
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe(first)
  })

  it('keeps the hand-written parts of an existing AGENTS.md', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      'AGENTS.md': '# shop\n\nRun the tests before you push.\n',
    })

    await runAgents(fakeContext(root), undefined, { noSkills: true })

    const contents = await readFile(join(root, 'AGENTS.md'), 'utf8')
    expect(contents).toContain('Run the tests before you push.')
    expect(contents).toContain('## Logging with evlog')
  })

  it('leaves already-installed skills to npx skills update', async () => {
    const root = await project({
      'package.json': '{"name":"shop"}',
      '.claude/skills/review-logging-patterns/SKILL.md': '# x\n',
    })

    const result = await runAgents(fakeContext(root), undefined, {})

    /* Nothing was spawned: an existing install is the skills CLI's to refresh,
       and re-adding it would be us duplicating what it already tracks. */
    expect(result.skills).toMatchObject({
      status: 'already',
      found: ['review-logging-patterns'],
      dirs: ['.claude/skills'],
    })
  })

  it('says so in the plan when the skills are already there', async () => {
    /* Doing nothing quietly reads as having forgotten the step — which is
       exactly how this looked before it was reported. */
    const root = await project({
      'package.json': '{"name":"shop"}',
      '.claude/skills/analyze-logs/SKILL.md': '# x\n',
    })

    const result = await runAgents(fakeContext(root), undefined, {})

    expect(result.already).toContain('evlog skills already installed · .claude/skills')
  })

  it('writes nothing and runs nothing under --dry-run', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const result = await runAgents(fakeContext(root), undefined, { dryRun: true })

    expect(result.written.length).toBeGreaterThan(0)
    expect(result.skills.status).toBe('skipped')
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('reports a failed install and keeps the block', async () => {
    skills.spawnResult = { ok: false, error: 'npx: command not found' }
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const result = await runAgents(fakeContext(root), undefined, {})

    expect(result.skills).toMatchObject({ status: 'failed', error: 'npx: command not found' })
    /* The block never needed the network, so it stands. */
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('One wide event per operation')
  })

  it('does not leave the block promising a skill the failed install never wrote', async () => {
    /* The block is written before the install so it survives a dead subprocess,
       which means on failure it names a skill that is now known to be absent. */
    skills.spawnResult = { ok: false, error: 'network unreachable' }
    const root = await project({ 'package.json': '{"name":"shop"}' })

    await runAgents(fakeContext(root), undefined, {})

    const contents = await readFile(join(root, 'AGENTS.md'), 'utf8')
    expect(contents).not.toContain('review-logging-patterns')
    expect(contents).toContain('https://evlog.dev/learn/wide-events')
  })

  it('records the command it ran, for a run nobody watched', async () => {
    /* Non-interactively the command never goes by on screen, so the report is
       the only record of what was spawned — which the trust model promises. */
    skills.spawnResult = { ok: true }
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const result = await runAgents(fakeContext(root), undefined, {})

    expect(formatAgentsReport(fakeContext(root), result)).toContain(result.skills.command)
  })

  it('marks a successful install without spawning twice', async () => {
    skills.spawnResult = { ok: true }
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const result = await runAgents(fakeContext(root), undefined, {})

    expect(result.skills.status).toBe('installed')
    expect(skills.calls).toBe(1)
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('review-logging-patterns')
  })

  it('still writes the block when no framework could be detected', async () => {
    const root = await project({ 'package.json': '{"name":"shop"}' })

    const result = await runAgents(fakeContext(root), undefined, { noSkills: true })

    expect(result.framework).toBeNull()
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('One wide event per operation')
  })
})
