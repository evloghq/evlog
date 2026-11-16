import git from 'eve/extensions/git'
import { GITHUB_CONNECTOR } from '../../lib/github/credentials'
import { authorizeGitHubCommand, brokerGitHubLease } from '../../lib/github/gh'

/** `git__gh` clones and fetches into the sandbox; branches go out through `git__push`, so it only reads contents. */
export default git({
  github: {
    connector: GITHUB_CONNECTOR,
    principalType: 'app',
    permissions: ['contents:read'],
    broker: brokerGitHubLease,
    authorize: authorizeGitHubCommand,
  },
})
