import { defineEval } from 'eve/evals'

export default defineEval({
  // git__push publishes a merge of the default branch and never force-pushes,
  // so the contributing skill updates a branch by merging main into it. The
  // answer must take that route, not a rebase, a replacement PR, or handing the
  // merge back to the maintainer.
  description: 'Asked to clear a pull request\'s merge conflict, the answer merges main into the branch and pushes it with git__push.',
  tags: ['fast'],
  async test(t) {
    await t.send('Say a pull request you opened on a branch of this repository now conflicts with main in pnpm-lock.yaml, and I ask you to fix the conflict. Walk me through exactly what you do.')
    t.succeeded()
    t.judge('merges main into the existing branch rather than rebasing it, force-pushing, or opening a replacement pull request').atLeast(0.5)
    t.judge('regenerates the lockfile, for example by taking main\'s copy and running pnpm install, instead of resolving it by hand').atLeast(0.5)
    t.judge('runs the checks and pushes the merge commit with git__push, rather than asking the maintainer to merge it locally').atLeast(0.5)
  },
})
