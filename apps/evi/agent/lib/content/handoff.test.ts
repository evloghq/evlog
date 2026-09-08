import { exec as execCallback, execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { applyRewrite, capturePage, loadPage } from './handoff'

const exec = promisify(execCallback)
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function repository() {
  const path = await mkdtemp(join(tmpdir(), 'evi-handoff-'))
  directories.push(path)
  execFileSync('git', ['init', '-q', path])
  execFileSync('git', ['-C', path, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', path, 'config', 'user.name', 'Test'])
  execFileSync('git', ['-C', path, 'config', 'commit.gpgsign', 'false'])
  await writeFile(join(path, 'page.md'), 'Committed page.\n')
  execFileSync('git', ['-C', path, 'add', '.'])
  execFileSync('git', ['-C', path, 'commit', '-qm', 'initial'])
  return path
}

function sandbox(path: string) {
  return {
    async run({ command, env }: { command: string, env?: Record<string, string> }) {
      try {
        const result = await exec(command.replaceAll('/workspace/repo', path), { env: { ...process.env, ...env } })
        return { ...result, exitCode: 0 }
      } catch (error) {
        const result = error as { stdout: string, stderr: string, code: number }
        return { ...result, exitCode: result.code }
      }
    },
    readTextFile: ({ path: file }: { path: string }) => readFile(file.replace('/workspace/repo', path), 'utf8'),
    writeTextFile: ({ path: file, content }: { path: string, content: string }) => writeFile(file.replace('/workspace/repo', path), content),
    removePath: ({ path: file }: { path: string }) => rm(file, { force: true }),
  }
}

describe('content handoff in the shared workspace', () => {
  it('refuses an outdated clone and reads the uncommitted draft from the shared workspace', async () => {
    const parent = await repository()
    const child = await mkdtemp(join(tmpdir(), 'evi-child-'))
    directories.push(child)
    execFileSync('git', ['clone', '-q', parent, child])
    await writeFile(join(parent, 'page.md'), 'Uncommitted draft.\n')
    const snapshot = await capturePage(sandbox(parent), 'page.md')

    await expect(loadPage(sandbox(child), snapshot)).rejects.toThrow('changed since')
    expect((await loadPage(sandbox(parent), snapshot)).text).toBe('Uncommitted draft.\n')
    expect(await readFile(join(child, 'page.md'), 'utf8')).toBe('Committed page.\n')

    const result = await applyRewrite(sandbox(parent), snapshot, 'Corrected draft.\n')
    expect(result.sha256).not.toBe(snapshot.sha256)
    expect(await readFile(join(parent, 'page.md'), 'utf8')).toBe('Corrected draft.\n')
  })

  it('supports a new page that does not exist on main', async () => {
    const path = await repository()
    await writeFile(join(path, 'new.md'), 'New page.\n')
    const snapshot = await capturePage(sandbox(path), 'new.md')
    expect((await loadPage(sandbox(path), snapshot)).text).toBe('New page.\n')
  })

  it('refuses a mismatched digest before reviewing', async () => {
    const path = await repository()
    const snapshot = await capturePage(sandbox(path), 'page.md')
    await expect(loadPage(sandbox(path), { ...snapshot, sha256: '0'.repeat(64) })).rejects.toThrow('changed since')
  })

  it('refuses uncommitted source changes instead of attesting to an older implementation', async () => {
    const path = await repository()
    await writeFile(join(path, 'logger.ts'), 'export const enabled = true\n')
    await expect(capturePage(sandbox(path), 'page.md')).rejects.toThrow('Commit source changes')
    execFileSync('git', ['-C', path, 'add', 'logger.ts'])
    await expect(capturePage(sandbox(path), 'page.md')).rejects.toThrow('Commit source changes')
  })

  it('refuses a page edited after the snapshot was captured', async () => {
    const path = await repository()
    const snapshot = await capturePage(sandbox(path), 'page.md')
    await writeFile(join(path, 'page.md'), 'Changed child.\n')
    await expect(loadPage(sandbox(path), snapshot)).rejects.toThrow('changed since')
  })

  it('rejects a markdown symlink that resolves outside the repository', async () => {
    const path = await repository()
    const other = await repository()
    await symlink(join(other, 'page.md'), join(path, 'outside.md'))
    await expect(capturePage(sandbox(path), 'outside.md')).rejects.toThrow('inside the repository')
  })

  it('does not overwrite a parent edit made after review', async () => {
    const path = await repository()
    const snapshot = await capturePage(sandbox(path), 'page.md')
    await writeFile(join(path, 'page.md'), 'New maintainer edit.\n')
    await expect(applyRewrite(sandbox(path), snapshot, 'Old rewrite.')).rejects.toThrow('changed since')
    expect(await readFile(join(path, 'page.md'), 'utf8')).toBe('New maintainer edit.\n')
  })

  it('preserves an edit made after the preliminary snapshot read', async () => {
    const path = await repository()
    const workspace = sandbox(path)
    const snapshot = await capturePage(workspace, 'page.md')
    const read = workspace.readTextFile
    workspace.readTextFile = async (input) => {
      const text = await read(input)
      await writeFile(join(path, 'page.md'), 'Edit during apply.\n')
      return text
    }

    await expect(applyRewrite(workspace, snapshot, 'Obsolete rewrite.')).rejects.toThrow('changed since')
    expect(await readFile(join(path, 'page.md'), 'utf8')).toBe('Edit during apply.\n')
  })

  it('allows only one concurrent rewrite of the same snapshot', async () => {
    const path = await repository()
    const workspace = sandbox(path)
    const snapshot = await capturePage(workspace, 'page.md')
    const results = await Promise.allSettled([
      applyRewrite(workspace, snapshot, 'First rewrite.\n'),
      applyRewrite(workspace, snapshot, 'Second rewrite.\n'),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const final = await capturePage(workspace, 'page.md')
    expect(results.find(result => result.status === 'fulfilled')).toMatchObject({ value: final })
  })

  it('applies a large passage without putting its contents in a process argument or environment', async () => {
    const path = await repository()
    const workspace = sandbox(path)
    const snapshot = await capturePage(workspace, 'page.md')
    const text = 'é'.repeat(190_000)
    await applyRewrite(workspace, snapshot, text)
    expect(await readFile(join(path, 'page.md'), 'utf8')).toBe(text)
  })

  it('invalidates a rewrite when the source revision changes', async () => {
    const path = await repository()
    const snapshot = await capturePage(sandbox(path), 'page.md')
    execFileSync('git', ['-C', path, 'commit', '--allow-empty', '-qm', 'new source'])
    await expect(applyRewrite(sandbox(path), snapshot, 'Old rewrite.')).rejects.toThrow('changed since')
  })

  it('refuses another source revision without changing the checkout', async () => {
    const path = await repository()
    const snapshot = await capturePage(sandbox(path), 'page.md')
    await expect(loadPage(sandbox(path), { ...snapshot, revision: 'a'.repeat(40) })).rejects.toThrow('source revision')
    expect(execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(snapshot.revision)
  })

  it('rejects paths outside the checkout and shell input masquerading as a revision', async () => {
    const path = await repository()
    await expect(capturePage(sandbox(path), '../page.md')).rejects.toThrow()
    const snapshot = await capturePage(sandbox(path), 'page.md')
    await expect(loadPage(sandbox(path), { ...snapshot, revision: '$(touch /tmp/invalid)' })).rejects.toThrow()
  })
})
