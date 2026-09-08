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
    async run({ command }: { command: string }) {
      try {
        const result = await exec(command.replaceAll('/workspace/repo', path))
        return { ...result, exitCode: 0 }
      } catch (error) {
        const result = error as { stdout: string, stderr: string, code: number }
        return { ...result, exitCode: result.code }
      }
    },
    readTextFile: ({ path: file }: { path: string }) => readFile(file.replace('/workspace/repo', path), 'utf8'),
    writeTextFile: ({ path: file, content }: { path: string, content: string }) => writeFile(file.replace('/workspace/repo', path), content),
  }
}

describe('content handoff between isolated sandboxes', () => {
  it('reviews the supplied draft rather than the child checkout and returns the rewrite to the parent', async () => {
    const parent = await repository()
    const child = await mkdtemp(join(tmpdir(), 'evi-child-'))
    directories.push(child)
    execFileSync('git', ['clone', '-q', parent, child])
    await writeFile(join(parent, 'page.md'), 'Uncommitted draft.\n')
    const snapshot = await capturePage(sandbox(parent), 'page.md')

    expect(await loadPage(sandbox(child), snapshot)).toEqual(snapshot)
    expect(snapshot.text).toBe('Uncommitted draft.\n')
    expect(await readFile(join(child, 'page.md'), 'utf8')).toBe('Committed page.\n')

    const result = await applyRewrite(sandbox(parent), snapshot, 'Corrected draft.\n')
    expect(result.text).toBe('Corrected draft.\n')
    expect(result.sha256).not.toBe(snapshot.sha256)
    expect(await readFile(join(parent, 'page.md'), 'utf8')).toBe(result.text)
  })

  it('supports a new page that does not exist on main', async () => {
    const path = await repository()
    await writeFile(join(path, 'new.md'), 'New page.\n')
    const snapshot = await capturePage(sandbox(path), 'new.md')
    expect((await loadPage(sandbox(path), snapshot)).text).toBe('New page.\n')
  })

  it('refuses a truncated or changed transfer before touching the checkout', async () => {
    const path = await repository()
    const snapshot = await capturePage(sandbox(path), 'page.md')
    await expect(loadPage(sandbox(path), { ...snapshot, text: 'Different page.' })).rejects.toThrow('digest')
  })

  it('refuses uncommitted source changes instead of attesting to an older implementation', async () => {
    const path = await repository()
    await writeFile(join(path, 'logger.ts'), 'export const enabled = true\n')
    await expect(capturePage(sandbox(path), 'page.md')).rejects.toThrow('Commit source changes')
    execFileSync('git', ['-C', path, 'add', 'logger.ts'])
    await expect(capturePage(sandbox(path), 'page.md')).rejects.toThrow('Commit source changes')
  })

  it('refuses a dirty child checkout instead of checking against local edits', async () => {
    const path = await repository()
    const snapshot = await capturePage(sandbox(path), 'page.md')
    await writeFile(join(path, 'page.md'), 'Changed child.\n')
    await expect(loadPage(sandbox(path), snapshot)).rejects.toThrow('local edits')
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

  it('invalidates a rewrite when the source revision changes', async () => {
    const path = await repository()
    const snapshot = await capturePage(sandbox(path), 'page.md')
    execFileSync('git', ['-C', path, 'commit', '--allow-empty', '-qm', 'new source'])
    await expect(applyRewrite(sandbox(path), snapshot, 'Old rewrite.')).rejects.toThrow('changed since')
  })

  it('fails closed when the requested source revision cannot be fetched', async () => {
    const path = await repository()
    const snapshot = await capturePage(sandbox(path), 'page.md')
    await expect(loadPage(sandbox(path), { ...snapshot, revision: 'a'.repeat(40) })).rejects.toThrow('source revision')
  })

  it('rejects paths outside the checkout and shell input masquerading as a revision', async () => {
    const path = await repository()
    await expect(capturePage(sandbox(path), '../page.md')).rejects.toThrow()
    const snapshot = await capturePage(sandbox(path), 'page.md')
    await expect(loadPage(sandbox(path), { ...snapshot, revision: '$(touch /tmp/invalid)' })).rejects.toThrow()
  })
})
