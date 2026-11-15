import git from 'eve/extensions/git'
import { GITHUB_CONNECTOR } from '../../lib/github/credentials'
import { authorizeGitHubCommand, brokerGitHubLease } from '../../lib/github/gh'

/** `git__gh` moves code between the sandbox and GitHub; contents is the only permission that needs. */
export default git({
  github: {
    connector: GITHUB_CONNECTOR,
    principalType: 'app',
    permissions: ['contents:write'],
    broker: brokerGitHubLease,
    authorize: authorizeGitHubCommand,
  },
})
