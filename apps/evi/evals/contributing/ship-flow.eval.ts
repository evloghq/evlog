import { defineEval } from 'eve/evals'

export default defineEval({
  // The shipping procedure lives in the contributing skill and the workspace
  // instructions: sandbox branch, checks, changeset, git__push, then the PR.
  // The answer must describe that flow, not file-by-file API writes.
  description: 'Asked how a fix ships, the answer walks the sandbox flow: branch, checks, changeset, push, pull request.',
  tags: ['fast'],
  async test(t) {
    await t.send('You fixed a bug in packages/evlog. Walk me through exactly how you get it merged.')
    t.succeeded()
    t.judge('describes working on a branch, running lint, typecheck and tests before opening the pull request').atLeast(0.5)
    t.judge('mentions adding a changeset for a user-facing change').atLeast(0.5)
    t.judge('names git__push (not a GitHub file API) as how the branch reaches the remote').atLeast(0.5)
  },
})
