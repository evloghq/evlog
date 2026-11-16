import type { SessionAuthContext } from 'eve/context'
import { describe, expect, it } from 'vitest'
import { authorizeGitHubCommand } from './gh'

const schedule: SessionAuthContext = { attributes: {}, authenticator: 'app', principalId: 'eve:app', principalType: 'runtime' }
const stranger: SessionAuthContext = { attributes: {}, authenticator: 'github-webhook', principalId: 'github:67890', principalType: 'user' }
const remote = 'https://github.com/evloghq/evlog.git'

const allowed = (argv: string[], auth: SessionAuthContext | null = schedule) => authorizeGitHubCommand({ argv, auth })

describe('authorizeGitHubCommand', () => {
  it('lets maintainer and schedule turns clone and fetch', () => {
    expect(allowed(['gh', 'repo', 'clone', 'acme/widgets', '/workspace/acme/widgets'])).toBe(true)
    expect(allowed(['git', 'fetch', 'origin', 'main'])).toBe(true)
    expect(allowed(['git', '-C', '/workspace/acme/widgets', 'pull', remote, 'main'])).toBe(true)
  })

  it('refuses every push, so no unsigned commit reaches GitHub', () => {
    expect(allowed(['git', 'push', remote, 'fix/pipeline-flush'])).toBe(false)
    expect(allowed(['git', '-C', '/workspace/acme/widgets', 'push', '-u', 'origin', 'HEAD:refs/heads/fix/x'])).toBe(false)
    expect(allowed(['git', 'push', '--force-with-lease', remote, '+fix/x:fix/x'])).toBe(false)
  })

  it('keeps every other GitHub write on the github__* tools', () => {
    expect(allowed(['gh', 'pr', 'merge', '12'])).toBe(false)
    expect(allowed(['gh', 'release', 'create', 'v1.0.0'])).toBe(false)
    expect(allowed(['gh', 'api', '-X', 'DELETE', 'repos/evloghq/evlog/git/refs/heads/main'])).toBe(false)
    expect(allowed(['gh-signed-commit', '--repo', 'evloghq/evlog', '--branch', 'main'])).toBe(false)
    expect(allowed(['git', '-c', 'remote.origin.url=x', 'fetch', remote])).toBe(false)
  })

  it('refuses everyone else, reads included', () => {
    expect(allowed(['git', 'fetch', 'origin'], stranger)).toBe(false)
    expect(allowed(['git', 'fetch', remote], null)).toBe(false)
  })
})
