import { exec as execCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { agentBrowserInstallOptions, cacheWarmupCommand, failedWarmupChecks, workspaceBootstrapCommand } from './workspace-bootstrap'

const exec = promisify(execCallback)

describe('workspace bootstrap', () => {
  it('activates the pinned package manager without writing global shims', () => {
    expect(workspaceBootstrapCommand).toContain('corepack prepare --activate')
    expect(workspaceBootstrapCommand).toContain('pnpm install --frozen-lockfile')
    expect(workspaceBootstrapCommand).toContain('pnpm run dev:prepare')
    expect(workspaceBootstrapCommand).not.toContain('corepack enable')
  })

  it('runs every check past a failing one and exits 0', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evi-warmup-'))
    try {
      await mkdir(join(root, 'repo'))
      await mkdir(join(root, 'bin'))
      // Records each call and exits 1 on typecheck, the exit code eve's preparation aborts on.
      await writeFile(join(root, 'bin', 'pnpm'), '#!/bin/sh\necho "$*" >> ../calls\n[ "$2" != typecheck ]\n', { mode: 0o755 })
      const { stdout } = await exec(cacheWarmupCommand, { cwd: root, env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}` } })
      expect(failedWarmupChecks(stdout)).toEqual(['typecheck'])
      expect(await readFile(join(root, 'calls'), 'utf8')).toBe('run lint --continue\nrun typecheck --continue\nrun test --continue\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('skips the unavailable Chrome for Testing build on Linux ARM64', () => {
    expect(agentBrowserInstallOptions('aarch64\n')).toEqual({
      installBrowser: false,
      installSystemDependencies: false,
    })
    expect(agentBrowserInstallOptions('x86_64\n')).toEqual({
      installBrowser: true,
      installSystemDependencies: true,
    })
  })
})
