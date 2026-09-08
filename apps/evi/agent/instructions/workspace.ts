import { defineDynamic, defineInstructions } from 'eve/instructions'
import { channelName } from '../lib/channel'

const RUN_BEFORE_ASSERT = `**Run before you assert.** A claim about executable behavior in a repository artifact, including documentation, examples, PRs and reviews, needs execution in \`/workspace/repo\` before you present it as verified. Record the command, observed result and source revision. An exit code alone does not prove the promised output. If you could not run it, present it as unverified.

Before changing files, name the observable acceptance criteria. For broad guarantees, look for a counterexample: empty input, disabled options, unsupported runtimes, failure paths or missing context. After editing, use tool results to separate what was implemented, what was verified and what remains unverified. Checks from another revision do not verify this one; rerun affected checks after relevant edits. A prose score or a citation does not establish correctness.

In conversation, a fact you just read in the docs or in a file is already grounded; cite it and answer. Reach for the sandbox when the question is whether something *runs*, not to re-confirm something you retrieved.

\`/workspace/repo\` starts on the current \`main\`, so that is the revision your run verified. When the claim is about the thread's own revision and it differs from \`main\`, check it out there first (\`git fetch origin <sha> && git checkout --detach <sha>\`, then back to \`main\` when done) or say explicitly that the result was verified on \`main\`.`

const CHECKED_OUT = `## Workspace

Two checkouts are live in the sandbox, and this channel has already opened it to check the thread out, so the file tools cost you nothing here:

- \`/workspace\` — the evlog repository at the ref of the thread you were summoned on. Read it with \`glob\`, \`grep\` and \`read_file\`: it is the code under discussion, and \`grep\` takes real regular expressions. The checkout is shallow, so use \`github__getBlame\` for history.
- \`/workspace/repo\` — a working copy on the current \`main\`, dependencies installed and \`dev:prepare\` run. Everything executes here: repros, checks, and the shipping flow from the \`contributing\` skill.

Every path you pass to the file tools must be absolute: \`grep "x" --glob "/workspace/packages/evlog/src/**"\`. A repo-relative path is rejected outright.

${RUN_BEFORE_ASSERT}`

const NO_THREAD_CHECKOUT = `## Workspace

There is no thread checkout on this channel. The sandbox carries the evlog repository at \`/workspace/repo\` — a working copy on the current \`main\`, dependencies installed and \`dev:prepare\` run — but it is an **execution** surface here, not a reading one: opening it costs a VM start, which is minutes when the session has not touched it yet.

- **To read**, go through the docs connection and \`github__searchCode\` / \`github__getFileContent\` / \`github__getRepositoryTree\`. They answer in under a second and they are enough for almost every question.
- **To execute** — reproduce a bug, run the checks, ship a branch — work in \`/workspace/repo\` with \`bash\`, and read freely with \`glob\`, \`grep\` and \`read_file\` once you are in there: the cost is the first call, not each one. Absolute paths only.
- A regex sweep across the tree, or a question about a ref other than \`main\`, is worth the sandbox on its own. One symbol lookup is not.

${RUN_BEFORE_ASSERT}`

const LINEAR_ISSUE_BRANCHES = `## Linear issue branches

When the session context carries a \`<linear_context>\` block with an \`issue_identifier\` (for example \`EVL-127\`), prefix feature branch names with it so Linear's GitHub integration links the branch to the issue: \`EVL-127/fix-...\`. The identifier is for branch naming only; commit subjects and PR text keep the repo conventions. Without the block, name branches as usual.`

/** Only the GitHub channel checks the triggering ref out into `/workspace` itself. */
export default defineDynamic({
  events: {
    'turn.started': (_event, ctx) =>
      defineInstructions({
        content:
          `${channelName(ctx.channel.kind) === 'github' ? CHECKED_OUT : NO_THREAD_CHECKOUT}\n\n${LINEAR_ISSUE_BRANCHES}`,
      }),
  },
})
