import { exec as execCallback, execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { GH_SIGNED_COMMIT_SOURCE } from 'eve/internal/git'
import { afterEach, describe, expect, it } from 'vitest'
import { type GitHubCommand, pushSignedBranch } from './signed-push'

const exec = promisify(execCallback)
const directories: string[] = []
const REPOSITORY = { owner: 'acme', repo: 'widgets' }
const URL = 'https://github.com/acme/widgets.git'
const IDENTITY = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' }

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

// GitHub as gh-signed-commit sees it: the three requests it makes, answered from a bare repository.
const FAKE_GITHUB = `
import { execFileSync } from 'node:child_process'
const repo = process.env.FAKE_GITHUB_REPO
const git = (args, options = {}) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', ...options }).trim()
const json = (status, body) => new Response(JSON.stringify(body), { status })
const headline = process.argv[process.argv.indexOf('-m') + 1]
// Another writer lands a commit on the branch, at the moment FAKE_GITHUB_INTERLOPE_AT names.
const interlope = (name, at) => {
  if (headline !== process.env.FAKE_GITHUB_INTERLOPE || at !== process.env.FAKE_GITHUB_INTERLOPE_AT) return
  const env = { ...process.env, GIT_INDEX_FILE: repo + '/interloper-index', GIT_WORK_TREE: repo }
  git(['read-tree', git(['rev-parse', name])], { env })
  git(['update-index', '--add', '--cacheinfo', '100644,' + git(['hash-object', '-w', '--stdin'], { input: 'theirs\\n' }) + ',theirs.txt'], { env })
  git(['update-ref', name, git(['commit-tree', git(['write-tree'], { env }), '-p', git(['rev-parse', name]), '-m', 'theirs'])])
}
globalThis.fetch = async (url, init = {}) => {
  const { pathname } = new URL(url)
  const ref = /\\/git\\/ref\\/(.+)$/.exec(pathname)
  if (ref) {
    interlope('refs/' + decodeURIComponent(ref[1]), 'read')
    try { return json(200, { object: { sha: git(['rev-parse', '--verify', 'refs/' + decodeURIComponent(ref[1])], { stdio: 'pipe' }) } }) }
    catch { return json(404, {}) }
  }
  if (pathname !== '/graphql') return json(500, {})
  const { input } = JSON.parse(init.body).variables
  const name = 'refs/heads/' + input.branch.branchName
  interlope(name, 'commit')
  if (git(['rev-parse', name]) !== input.expectedHeadOid) return json(200, { errors: [{ message: 'stale head' }] })
  if (input.message.headline === process.env.FAKE_GITHUB_REFUSE) return json(200, { errors: [{ message: 'refused' }] })
  // update-index refuses a removal without a work tree, though it never reads one here.
  const env = { ...process.env, GIT_INDEX_FILE: repo + '/fake-index', GIT_WORK_TREE: repo }
  git(['read-tree', input.expectedHeadOid], { env })
  for (const { path, contents } of input.fileChanges.additions) {
    const blob = git(['hash-object', '-w', '--stdin'], { input: Buffer.from(contents, 'base64') })
    git(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + path], { env })
  }
  for (const { path } of input.fileChanges.deletions) git(['update-index', '--force-remove', path], { env })
  const message = [input.message.headline, input.message.body].filter(Boolean).join('\\n\\n')
  // GitHub commits as itself, so a signed replay never shares the local commit's sha.
  const oid = git(['commit-tree', git(['write-tree'], { env }), '-p', input.expectedHeadOid, '-m', message], { env: { ...env, GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com' } })
  git(['update-ref', name, oid])
  if (input.message.headline === process.env.FAKE_GITHUB_LOSE) return json(502, {})
  return json(200, { data: { createCommitOnBranch: { commit: { oid } } } })
}
`

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim()
}

async function run(command: string, env: NodeJS.ProcessEnv = process.env, broken: RegExp | null = null) {
  if (broken?.test(command)) return { stdout: '', stderr: 'broken on purpose', exitCode: 1, truncated: false }
  try {
    return { ...await exec(command, { encoding: 'utf8', env }), exitCode: 0, truncated: false }
  } catch (error) {
    const result = error as { stdout: string, stderr: string, code: number }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code, truncated: false }
  }
}

async function write(dir: string, files: Record<string, string | Buffer>) {
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true })
    await writeFile(join(dir, path), contents)
  }
}

async function commit(dir: string, message: string, files: Record<string, string | Buffer> = {}, removed: string[] = []): Promise<string> {
  await write(dir, files)
  for (const path of removed) git(dir, 'rm', '-q', path)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', message)
  return git(dir, 'rev-parse', 'HEAD')
}

/**
 * A clone on a fresh `feat` branch whose GitHub is a local bare repository,
 * reached under the real URL. `push` runs eve's gh-signed-commit script, with
 * its requests answered by that bare repository instead of api.github.com.
 */
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'evi-signed-push-'))
  directories.push(root)
  const github = join(root, 'github.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', github])
  const seed = join(root, 'seed')
  execFileSync('git', ['init', '-q', '-b', 'main', seed])
  git(seed, 'remote', 'add', 'origin', github)
  await write(seed, { 'README.md': 'Widgets.\n', 'keep.txt': 'kept\n', 'run.sh': '#!/bin/sh\n' })
  await chmod(join(seed, 'run.sh'), 0o755)
  await commit(seed, 'initial')
  git(seed, 'push', '-q', 'origin', 'main')

  const work = join(root, 'work')
  execFileSync('git', ['clone', '-q', github, work])
  git(work, 'remote', 'set-url', 'origin', URL)
  git(work, 'config', `url.${github}.insteadOf`, URL)
  git(work, 'config', 'user.email', 't@example.com')
  git(work, 'config', 'user.name', 'T')
  git(work, 'config', 'commit.gpgsign', 'false')
  git(work, 'checkout', '-qb', 'feat')

  const bin = join(root, 'bin')
  await write(root, { 'fake-github.mjs': FAKE_GITHUB, 'gh-signed-commit.cjs': GH_SIGNED_COMMIT_SOURCE })
  await write(bin, { 'gh-signed-commit': `#!/bin/sh\nexec node --import ${join(root, 'fake-github.mjs')} ${join(root, 'gh-signed-commit.cjs')} "$@"\n` })
  await chmod(join(bin, 'gh-signed-commit'), 0o755)
  const env = { ...process.env, ...IDENTITY, PATH: `${bin}:${process.env.PATH}`, GH_TOKEN: 'placeholder', FAKE_GITHUB_REPO: github, FAKE_GITHUB_REFUSE: '', FAKE_GITHUB_INTERLOPE: '', FAKE_GITHUB_INTERLOPE_AT: '', FAKE_GITHUB_LOSE: '' }
  let broken: RegExp | null = null
  const gh: GitHubCommand = ({ command, workingDirectory }) => run(`cd ${workingDirectory} && ${command}`, env, broken)
  const sandbox = { run: ({ command }: { command: string }) => run(command, process.env, broken) } as Parameters<typeof pushSignedBranch>[0]
  return {
    seed,
    work,
    github,
    push: () => pushSignedBranch(sandbox, gh, { dir: work, repository: REPOSITORY, branch: 'feat' }),
    /** GitHub rejects the commit with this headline. */
    refuse: (headline: string) => {
      env.FAKE_GITHUB_REFUSE = headline
    },
    /**
     * Another writer pushes to the branch while the commit with this headline is
     * published: before gh-signed-commit reads the branch head, or between that
     * read and the commit, where GitHub refuses the stale expected head.
     */
    interlope: (headline: string, at: 'read' | 'commit') => {
      env.FAKE_GITHUB_INTERLOPE = headline
      env.FAKE_GITHUB_INTERLOPE_AT = at
    },
    /** Every command matching `pattern` exits 1, in the sandbox and through the GitHub lease alike. */
    breakCommand: (pattern: RegExp | null) => {
      broken = pattern
    },
    /** GitHub takes the commit with this headline but its reply never arrives. */
    lose: (headline: string) => {
      env.FAKE_GITHUB_LOSE = headline
    },
  }
}

function messages(dir: string, range: string): string[] {
  return git(dir, 'log', '--format=%B%x00', range).split('\0').map(message => message.trim()).filter(Boolean)
}

describe('pushSignedBranch', () => {
  it('publishes each new commit on the base it forked from and moves the local branch onto them', async () => {
    const { seed, work, github, push } = await setup()
    const base = git(work, 'rev-parse', 'HEAD')
    // main moves on GitHub after the fork; the pushed branch must still start from its own base.
    await commit(seed, 'later on main', { 'README.md': 'Widgets, on main.\n' })
    git(seed, 'push', '-q', 'origin', 'main')
    const binary = Buffer.from([0, 255, 10, 13, 128])
    await commit(work, 'feat: add notes\n\nIt\'s why $HOME and `ls` stay literal.', { 'README.md': 'Widgets, updated.\n', 'docs/my notes.txt': 'spaced path\n', 'logo.bin': binary })
    const head = await commit(work, 'chore: drop keep', {}, ['keep.txt'])

    const result = await push()

    expect(result).toEqual({ sha: git(github, 'rev-parse', 'feat'), commits: 2 })
    expect(messages(github, `${base}..feat`)).toEqual(['chore: drop keep', 'feat: add notes\n\nIt\'s why $HOME and `ls` stay literal.'])
    expect(git(github, 'rev-parse', 'feat~2')).toBe(base)
    expect(git(github, 'rev-parse', 'feat~1^{tree}')).toBe(git(work, 'rev-parse', `${head}~1^{tree}`))
    expect(git(github, 'rev-parse', 'feat^{tree}')).toBe(git(work, 'rev-parse', `${head}^{tree}`))
    expect(git(work, 'rev-parse', 'feat')).toBe(result.sha)
    expect(git(work, 'status', '--porcelain')).toBe('')
    expect(git(work, 'worktree', 'list').split('\n')).toHaveLength(1)
  })

  it('publishes only what GitHub lacks when the branch is already there', async () => {
    const { work, github, push } = await setup()
    await commit(work, 'first', { 'a.txt': 'a\n' })
    const first = await push()
    await commit(work, 'second', { 'b.txt': 'b\n' })

    const result = await push()

    expect(result.commits).toBe(1)
    expect(git(github, 'rev-parse', 'feat^')).toBe(first.sha)
    expect(messages(github, `${first.sha}..feat`)).toEqual(['second'])
  })

  it('refuses what a signed push cannot reproduce before anything reaches GitHub', async () => {
    const executable = await setup()
    await commit(executable.work, 'touch script', { 'run.sh': '#!/bin/sh\necho hi\n' })
    await expect(executable.push()).rejects.toMatchObject({ code: 'evi.GIT_PUSH_REFUSED', message: expect.stringContaining('run.sh') })
    expect(git(executable.github, 'branch', '--list', 'feat')).toBe('')

    const merged = await setup()
    await commit(merged.work, 'on feat', { 'a.txt': 'a\n' })
    git(merged.work, 'checkout', '-qb', 'side', 'origin/main')
    await commit(merged.work, 'on side', { 'b.txt': 'b\n' })
    git(merged.work, 'checkout', '-q', 'feat')
    git(merged.work, 'merge', '-q', '--no-edit', 'side')
    await expect(merged.push()).rejects.toMatchObject({ message: expect.stringContaining('merge commit') })
    expect(git(merged.github, 'branch', '--list', 'feat')).toBe('')

    const empty = await setup()
    await commit(empty.work, 'first', { 'a.txt': 'a\n' })
    git(empty.work, 'commit', '-q', '--allow-empty', '-m', 'nothing')
    await commit(empty.work, 'third', { 'c.txt': 'c\n' })
    await expect(empty.push()).rejects.toMatchObject({ code: 'evi.GIT_PUSH_REFUSED', message: expect.stringContaining('changes no files') })
    expect(git(empty.github, 'branch', '--list', 'feat')).toBe('')
  })

  it('refuses a merge made locally after part of the branch landed', async () => {
    const { work, github, push, refuse } = await setup()
    await commit(work, 'first', { 'a.txt': 'a\n' })
    await commit(work, 'second', { 'b.txt': 'b\n' })
    refuse('second')
    await expect(push()).rejects.toMatchObject({ message: expect.stringContaining('1 of 2 commits reached GitHub') })
    const landed = git(github, 'rev-parse', 'feat')

    git(work, 'checkout', '-qb', 'side', 'origin/main')
    await commit(work, 'on side', { 'd.txt': 'd\n' })
    git(work, 'checkout', '-q', 'feat')
    git(work, 'merge', '-q', '--no-edit', 'side')
    const head = git(work, 'rev-parse', 'feat')
    refuse('')

    await expect(push()).rejects.toMatchObject({ code: 'evi.GIT_PUSH_REFUSED', message: expect.stringContaining('merge commit') })
    expect(git(github, 'rev-parse', 'feat')).toBe(landed)
    expect(git(work, 'rev-parse', 'feat')).toBe(head)
  })

  it('refuses a branch on GitHub that the local branch does not build on', async () => {
    const { seed, work, github, push } = await setup()
    git(seed, 'checkout', '-qb', 'feat')
    await commit(seed, 'someone else', { 'c.txt': 'c\n' })
    git(seed, 'push', '-q', 'origin', 'feat')
    const theirs = git(github, 'rev-parse', 'feat')
    await commit(work, 'mine', { 'a.txt': 'a\n' })

    await expect(push()).rejects.toMatchObject({ code: 'evi.GIT_PUSH_REFUSED' })
    expect(git(github, 'rev-parse', 'feat')).toBe(theirs)
  })

  it('resumes after GitHub takes only part of the branch, once GitHub can be read again', async () => {
    const { work, github, push, refuse, breakCommand } = await setup()
    await commit(work, 'first', { 'a.txt': 'a\n' })
    const head = await commit(work, 'second', { 'b.txt': 'b\n' })
    const tree = git(work, 'rev-parse', 'feat^{tree}')
    refuse('second')

    await expect(push()).rejects.toMatchObject({ code: 'evi.GIT_COMMAND_FAILED', message: expect.stringContaining('1 of 2 commits reached GitHub') })
    expect(messages(github, 'main..feat')).toEqual(['first'])
    expect(git(work, 'rev-parse', 'feat')).toBe(head)

    // An unreadable GitHub is an unknown state, not another writer: nothing is refused or rewritten.
    refuse('')
    breakCommand(/git fetch/)
    await expect(push()).rejects.toMatchObject({ code: 'evi.GIT_COMMAND_FAILED' })
    expect(git(work, 'rev-parse', 'feat')).toBe(head)

    breakCommand(null)
    const retry = await push()

    expect(retry.commits).toBe(1)
    expect(messages(github, 'main..feat')).toEqual(['second', 'first'])
    expect(git(github, 'rev-parse', 'feat^{tree}')).toBe(tree)
  })

  it('stops and keeps the other writer\'s commit when the branch moves before a publish reads it', async () => {
    const { work, github, push, interlope } = await setup()
    await commit(work, 'first', { 'a.txt': 'a\n' })
    await commit(work, 'second', { 'b.txt': 'b\n' })
    const head = await commit(work, 'third', { 'c.txt': 'c\n' })
    interlope('second', 'read')

    await expect(push()).rejects.toMatchObject({ code: 'evi.GIT_PUSH_REFUSED', message: expect.stringContaining('moved while this push ran') })
    expect(git(work, 'rev-parse', 'feat')).toBe(head)
    expect(messages(github, 'main..feat')).toEqual(['second', 'theirs', 'first'])
    expect(git(github, 'show', 'feat:theirs.txt')).toBe('theirs')

    interlope('', 'read')
    await expect(push()).rejects.toMatchObject({ code: 'evi.GIT_PUSH_REFUSED', message: expect.stringContaining('does not contain') })
    expect(git(github, 'show', 'feat:theirs.txt')).toBe('theirs')
  })

  it('leaves the other writer\'s commit alone when GitHub refuses the stale head', async () => {
    const { work, github, push, interlope } = await setup()
    await commit(work, 'first', { 'a.txt': 'a\n' })
    const head = await commit(work, 'second', { 'b.txt': 'b\n' })
    interlope('second', 'commit')

    await expect(push()).rejects.toMatchObject({ code: 'evi.GIT_COMMAND_FAILED', message: expect.stringContaining('stale head') })
    expect(git(work, 'rev-parse', 'feat')).toBe(head)
    expect(messages(github, 'main..feat')).toEqual(['theirs', 'first'])

    interlope('', 'commit')
    await expect(push()).rejects.toMatchObject({ code: 'evi.GIT_PUSH_REFUSED', message: expect.stringContaining('does not contain') })
    expect(messages(github, 'main..feat')).toEqual(['theirs', 'first'])
  })

  it('resumes after a local replay step fails once a commit has landed', async () => {
    const { work, github, push, breakCommand } = await setup()
    await commit(work, 'first', { 'a.txt': 'a\n' })
    const second = await commit(work, 'second', { 'b.txt': 'b\n' })
    const tree = git(work, 'rev-parse', 'feat^{tree}')
    breakCommand(new RegExp(`read-tree -u --reset ${second}`))

    await expect(push()).rejects.toMatchObject({ code: 'evi.GIT_COMMAND_FAILED', message: expect.stringContaining('read-tree') })
    expect(messages(github, 'main..feat')).toEqual(['first'])
    expect(git(work, 'rev-parse', 'feat')).toBe(second)

    breakCommand(null)
    const retry = await push()

    expect(retry.commits).toBe(1)
    expect(messages(github, 'main..feat')).toEqual(['second', 'first'])
    expect(git(github, 'rev-parse', 'feat^{tree}')).toBe(tree)
    expect(git(work, 'rev-parse', 'feat')).toBe(retry.sha)
  })

  it('reads what landed from GitHub when a reply is lost', async () => {
    const { work, github, push, lose } = await setup()
    await commit(work, 'first', { 'a.txt': 'a\n' })
    await commit(work, 'second', { 'b.txt': 'b\n' })
    const head = await commit(work, 'third', { 'c.txt': 'c\n' })
    const tree = git(work, 'rev-parse', 'feat^{tree}')
    lose('second')

    await expect(push()).rejects.toMatchObject({ message: expect.stringContaining('may have landed too') })
    expect(messages(github, 'main..feat')).toEqual(['second', 'first'])
    expect(git(work, 'rev-parse', 'feat')).toBe(head)

    lose('')
    const retry = await push()

    expect(retry.commits).toBe(1)
    expect(messages(github, 'main..feat')).toEqual(['third', 'second', 'first'])
    expect(git(github, 'rev-parse', 'feat^{tree}')).toBe(tree)
  })
})
