import type { SessionAuthContext } from 'eve/context'
import { describe, expect, it } from 'vitest'
import { authorizeGitHubCommand } from './gh'

const schedule: SessionAuthContext = { attributes: {}, authenticator: 'app', principalId: 'eve:app', principalType: 'runtime' }
const stranger: SessionAuthContext = { attributes: {}, authenticator: 'github-webhook', principalId: 'github:67890', principalType: 'user' }
const remote = 'https://github.com/evloghq/evlog.git'

const allowed = (argv: string[], auth: SessionAuthContext | null = schedule) => authorizeGitHubCommand({ argv, auth })

describe('authorizeGitHubCommand', () => {
  it('lets maintainer and schedule turns clone, fetch and push a feature branch', () => {
    expect(allowed(['gh', 'repo', 'clone', 'acme/widgets', '/workspace/acme/widgets'])).toBe(true)
    expect(allowed(['git', 'fetch', 'origin', 'main'])).toBe(true)
    expect(allowed(['git', 'push', remote, 'fix/pipeline-flush'])).toBe(true)
    expect(allowed(['git', '-C', '/workspace/acme/widgets', 'push', '-u', 'origin', 'HEAD:refs/heads/fix/x'])).toBe(true)
    expect(allowed(['git', 'push', '--force-with-lease', remote, '+fix/x:fix/x'])).toBe(true)
    expect(allowed(['git', 'push', remote, 'feature/main'])).toBe(true)
  })

  it('refuses every push that lands on main or master, under any name', () => {
    for (const refspec of ['main', 'master', '+main', 'HEAD:main', 'fix/x:refs/heads/master', 'fix/x:main']) {
      expect(allowed(['git', 'push', remote, refspec]), refspec).toBe(false)
    }
    expect(allowed(['git', 'push', remote, 'fix/x', 'main'])).toBe(false)
  })

  it('refuses pushes whose target depends on what is checked out or reaches beyond one branch', () => {
    expect(allowed(['git', 'push'])).toBe(false)
    expect(allowed(['git', 'push', 'origin'])).toBe(false)
    expect(allowed(['git', 'push', remote, 'HEAD'])).toBe(false)
    expect(allowed(['git', 'push', remote, 'fix/x:HEAD'])).toBe(false)
    expect(allowed(['git', 'push', remote, ':fix/x'])).toBe(false)
    expect(allowed(['git', 'push', '--delete', remote, 'fix/x'])).toBe(false)
    expect(allowed(['git', 'push', '--all', remote])).toBe(false)
    expect(allowed(['git', 'push', '--tags', remote, 'fix/x'])).toBe(false)
    expect(allowed(['git', 'push', remote, 'v1:refs/tags/v1'])).toBe(false)
    expect(allowed(['git', 'push', remote, 'refs/heads/*:refs/heads/*'])).toBe(false)
    expect(allowed(['git', 'push', '-o', 'ci.skip', remote, 'fix/x'])).toBe(false)
  })

  it('keeps every other GitHub write on the github__* tools', () => {
    expect(allowed(['gh', 'pr', 'merge', '12'])).toBe(false)
    expect(allowed(['gh', 'release', 'create', 'v1.0.0'])).toBe(false)
    expect(allowed(['gh', 'api', '-X', 'DELETE', 'repos/evloghq/evlog/git/refs/heads/main'])).toBe(false)
    expect(allowed(['gh-signed-commit', '--repo', 'evloghq/evlog', '--branch', 'main'])).toBe(false)
    expect(allowed(['git', '-c', 'remote.origin.url=x', 'push', remote, 'fix/x'])).toBe(false)
  })

  it('refuses everyone else, reads included', () => {
    expect(allowed(['git', 'fetch', 'origin'], stranger)).toBe(false)
    expect(allowed(['git', 'push', remote, 'fix/x'], null)).toBe(false)
  })
})
