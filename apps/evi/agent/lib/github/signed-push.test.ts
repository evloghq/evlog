import { exec as execCallback, execFileSync } from 'node:child_process'
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectBranchCommits, pushSignedCommits, remoteBranchHead } from './signed-push'

const exec = promisify(execCallback)
const directories: string[] = []
const REPOSITORY = { owner: 'acme', repo: 'widgets' }

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const sandbox = {
  async run({ command }: { command: string }) {
    try {
      return { ...await exec(command, { encoding: 'utf8' }), exitCode: 0 }
    } catch (error) {
      const result = error as { stdout: string, stderr: string, code: number }
      return { ...result, exitCode: result.code }
    }
  },
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
}

/** A clone of a one-commit origin, on a fresh `feat` branch. */
async function clone(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'evi-signed-push-'))
  directories.push(root)
  const origin = join(root, 'origin')
  execFileSync('git', ['init', '-q', '-b', 'main', origin])
  await writeFile(join(origin, 'README.md'), 'Widgets.\n')
  await writeFile(join(origin, 'keep.txt'), 'kept\n')
  await writeFile(join(origin, 'run.sh'), '#!/bin/sh\n')
  await chmod(join(origin, 'run.sh'), 0o755)
  git(origin, 'add', '.')
  git(origin, '-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial')
  const work = join(root, 'work')
  execFileSync('git', ['clone', '-q', origin, work])
  git(work, 'config', 'user.email', 't@example.com')
  git(work, 'config', 'user.name', 'T')
  git(work, 'config', 'commit.gpgsign', 'false')
  git(work, 'checkout', '-qb', 'feat')
  return work
}

async function commit(dir: string, message: string, files: Record<string, string | Buffer> = {}, removed: string[] = []): Promise<string> {
  for (const [path, contents] of Object.entries(files)) {
    execFileSync('mkdir', ['-p', join(dir, path, '..')])
    await writeFile(join(dir, path), contents)
  }
  for (const path of removed) git(dir, 'rm', '-q', path)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', message)
  return git(dir, 'rev-parse', 'HEAD')
}

describe('collectBranchCommits', () => {
  it('reads every commit after the remote-tracking branches, with exact bytes and deletions', async () => {
    const dir = await clone()
    const binary = Buffer.from([0, 255, 10, 13, 128])
    await commit(dir, 'feat: add notes\n\nWhy the notes exist.', { 'README.md': 'Widgets, updated.\n', 'docs/my notes.txt': 'spaced path\n', 'logo.bin': binary })
    await commit(dir, 'chore: drop keep', {}, ['keep.txt'])

    const { base, head, branchExists, commits } = await collectBranchCommits(sandbox, dir, 'feat', null)

    expect(base).toBe(git(dir, 'rev-parse', 'origin/main'))
    expect(head).toBe(git(dir, 'rev-parse', 'feat'))
    expect(branchExists).toBe(false)
    expect(commits.map(c => c.message.trim())).toEqual(['feat: add notes\n\nWhy the notes exist.', 'chore: drop keep'])
    const files = Object.fromEntries(commits[0]!.additions.map(a => [a.path, Buffer.from(a.contents, 'base64')]))
    expect(files).toEqual({ 'README.md': Buffer.from('Widgets, updated.\n'), 'docs/my notes.txt': Buffer.from('spaced path\n'), 'logo.bin': binary })
    expect(commits[0]!.deletions).toEqual([])
    expect(commits[1]).toMatchObject({ additions: [], deletions: [{ path: 'keep.txt' }] })
  })

  it('starts after the branch head on GitHub when the branch already exists there', async () => {
    const dir = await clone()
    const first = await commit(dir, 'first', { 'a.txt': 'a\n' })
    await commit(dir, 'second', { 'b.txt': 'b\n' })

    const { base, branchExists, commits } = await collectBranchCommits(sandbox, dir, 'feat', first)

    expect(base).toBe(first)
    expect(branchExists).toBe(true)
    expect(commits.map(c => c.message.trim())).toEqual(['second'])
  })

  it('refuses a branch on GitHub that the local branch does not contain', async () => {
    const dir = await clone()
    await commit(dir, 'local', { 'a.txt': 'a\n' })
    await expect(collectBranchCommits(sandbox, dir, 'feat', 'f'.repeat(40))).rejects.toMatchObject({ code: 'evi.GIT_PUSH_REFUSED' })
  })

  it('refuses changes a signed push cannot reproduce', async () => {
    const executable = await clone()
    await commit(executable, 'touch script', { 'run.sh': '#!/bin/sh\necho hi\n' })
    await expect(collectBranchCommits(sandbox, executable, 'feat', null)).rejects.toMatchObject({ code: 'evi.GIT_PUSH_REFUSED', message: expect.stringContaining('run.sh') })

    const linked = await clone()
    await symlink('README.md', join(linked, 'link.md'))
    await commit(linked, 'add link')
    await expect(collectBranchCommits(sandbox, linked, 'feat', null)).rejects.toMatchObject({ message: expect.stringContaining('link.md') })

    const merged = await clone()
    await commit(merged, 'on feat', { 'a.txt': 'a\n' })
    git(merged, 'checkout', '-qb', 'side', 'origin/main')
    await commit(merged, 'on side', { 'b.txt': 'b\n' })
    git(merged, 'checkout', '-q', 'feat')
    git(merged, 'merge', '-q', '--no-edit', 'side')
    await expect(collectBranchCommits(sandbox, merged, 'feat', null)).rejects.toMatchObject({ message: expect.stringContaining('merge commit') })
  })
})

describe('pushSignedCommits', () => {
  const commits = [
    { message: 'feat: add notes\n\nWhy the notes exist.\n', additions: [{ path: 'a.txt', contents: 'YQo=' }], deletions: [] },
    { message: 'chore: drop keep\n', additions: [], deletions: [{ path: 'keep.txt' }] },
  ]

  it('creates the branch at the base, then chains each commit on the one GitHub returned', async () => {
    const calls: Array<{ url: string, body: any }> = []
    let next = 0
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      if (url.endsWith('/git/refs')) return Promise.resolve(new Response('{}', { status: 201 }))
      next += 1
      return Promise.resolve(Response.json({ data: { createCommitOnBranch: { commit: { oid: String(next).repeat(40) } } } }))
    }))

    const head = await pushSignedCommits('tok', REPOSITORY, 'feat', { base: 'b'.repeat(40), head: 'h'.repeat(40), branchExists: false, commits })

    expect(head).toBe('2'.repeat(40))
    expect(calls[0]).toEqual({ url: 'https://api.github.com/repos/acme/widgets/git/refs', body: { ref: 'refs/heads/feat', sha: 'b'.repeat(40) } })
    expect(calls.slice(1).map(call => call.body.variables.input)).toEqual([
      {
        branch: { repositoryNameWithOwner: 'acme/widgets', branchName: 'feat' },
        expectedHeadOid: 'b'.repeat(40),
        message: { headline: 'feat: add notes', body: 'Why the notes exist.' },
        fileChanges: { additions: [{ path: 'a.txt', contents: 'YQo=' }], deletions: [] },
      },
      {
        branch: { repositoryNameWithOwner: 'acme/widgets', branchName: 'feat' },
        expectedHeadOid: '1'.repeat(40),
        message: { headline: 'chore: drop keep' },
        fileChanges: { additions: [], deletions: [{ path: 'keep.txt' }] },
      },
    ])
  })

  it('fails on a GraphQL error and keeps the response body out of the message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ errors: [{ message: 'Expected branch to point to b' }] }))))
    const failure = pushSignedCommits('tok', REPOSITORY, 'feat', { base: 'b'.repeat(40), head: 'h'.repeat(40), branchExists: true, commits })
    await expect(failure).rejects.toMatchObject({ code: 'evi.GITHUB_REQUEST_FAILED', message: 'GitHub commit creation failed (200)' })
  })

  it('puts the branch back only while it is at the last commit the push wrote, and deletes a branch it created', async () => {
    const calls: Array<{ url: string, body: any }> = []
    let restore: unknown = { data: { updateRefs: { clientMutationId: null } } }
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? '{}'))
      calls.push({ url, body })
      if (!url.endsWith('/graphql')) return Promise.resolve(new Response('{}', { status: 201 }))
      if (body.query.includes('createCommitOnBranch')) {
        const done = calls.filter(call => call.body.query?.includes('createCommitOnBranch')).length
        return Promise.resolve(done === 1
          ? Response.json({ data: { createCommitOnBranch: { commit: { oid: '1'.repeat(40) } } } })
          : Response.json({ errors: [{ message: 'boom' }] }))
      }
      if (body.query.includes('repository(')) return Promise.resolve(Response.json({ data: { repository: { id: 'R_1' } } }))
      return Promise.resolve(Response.json(restore))
    }))
    const push = (branchExists: boolean) => pushSignedCommits('tok', REPOSITORY, 'feat', { base: 'b'.repeat(40), head: 'h'.repeat(40), branchExists, commits })
    const restored = () => calls.at(-1)!.body.variables.input

    await expect(push(true)).rejects.toMatchObject({ message: 'GitHub commit creation failed (200)' })
    expect(restored()).toEqual({ repositoryId: 'R_1', refUpdates: [{ name: 'refs/heads/feat', beforeOid: '1'.repeat(40), afterOid: 'b'.repeat(40), force: true }] })

    calls.length = 0
    await expect(push(false)).rejects.toMatchObject({ message: 'GitHub commit creation failed (200)' })
    expect(restored()).toEqual({ repositoryId: 'R_1', refUpdates: [{ name: 'refs/heads/feat', beforeOid: '1'.repeat(40), afterOid: '0'.repeat(40), force: true }] })

    calls.length = 0
    restore = { data: null, errors: [{ message: 'feat no longer points at 1111111' }] }
    await expect(push(true)).rejects.toMatchObject({ code: 'evi.GITHUB_REQUEST_FAILED', message: 'GitHub branch restore failed (200)' })
  })
})

describe('remoteBranchHead', () => {
  it('returns null when GitHub has no such branch', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))))
    expect(await remoteBranchHead('tok', REPOSITORY, 'feat')).toBeNull()
  })

  it('returns the head sha of an existing branch', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ object: { sha: 'c'.repeat(40) } }))))
    expect(await remoteBranchHead('tok', REPOSITORY, 'feat')).toBe('c'.repeat(40))
  })
})
