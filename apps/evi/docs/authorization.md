# Authorization on the GitHub channel

Design note, not implemented. Written while Evi is still gated to a single user
(`onComment` rejects everyone but `hugorcd`). Pick this up before that gate comes
off, or before wiring the autonomous webhook hooks. The gate is required before
either is implemented.

## Approval is not an authorization control here

Evi now carries the full maintainer tool surface, and every write tool ships
behind the SDK's `always()` approval. On Slack or the web that is a real control.
On GitHub it is not, for three compounding reasons:

1. **There is no approval card.** Per eve's GitHub channel docs, an
   `input.requested` event "is posted as a comment prompt, and the user's reply
   comment maps back to the pending input request." It is a comment.
2. **Whoever replies first answers it.** Nothing binds the reply to the person who
   triggered the turn. An attacker approves their own write.
3. **Autonomous turns have nobody to ask.** Once `onIssue` / `onPullRequest` /
   `onCheckSuite` are wired, a turn that hits an approval gate parks forever.

Approval is an interaction pattern for a trusted one-to-one channel. On a public
thread it confirms nothing. The control has to be authorization: decided
server-side, from an identity the actor cannot choose.

## Decide at dispatch, not at the tool

`onComment` runs on a webhook GitHub has signed, before any model exists, and it
may be async. `defaultGitHubAuth(ctx)` already projects the actor into
`principalId: "github:<sender.id>"` (the numeric id, so a login rename or
re-registration does not move it) with `principalType: "user"` (or `"service"`
for bots) and repository metadata in `attributes`.

So: resolve a tier there, stamp it on `auth.attributes`, and let everything
downstream read it.

```ts
// agent/channels/github.ts
const ADMIN_IDS = new Set([/* numeric GitHub user ids */])

async function tierFor(ctx: GitHubInboundContext): Promise<'admin' | 'public'> {
  if (ADMIN_IDS.has(ctx.sender.id)) return 'admin'
  // Ask GitHub who can push. Falls back closed when the call fails.
  const permission = await collaboratorPermission(ctx).catch(() => null)
  return permission === 'admin' || permission === 'write' ? 'admin' : 'public'
}
```

Both paths on purpose: the hardcoded set keeps working when the API call fails or
rate-limits, and the permission lookup means adding a maintainer on GitHub is
enough: nobody has to remember to edit this file.

**Cache the lookup by actor id, never by session.** A GitHub thread is one
session that different people comment in, so a tier cached on the session would
be handed to whoever comments next. Key it on `ctx.sender.id` and re-resolve when
the actor changes; the id is numeric and immutable, so it is a safe cache key.
Without that, a maintainer's turn raises the tier for every later commenter in
the same thread.

Then merge the tier into the auth the hook returns:

```ts
const auth = defaultGitHubAuth(ctx)
return { auth: { ...auth, attributes: { ...auth.attributes, tier } } }
```

## Enforce with the approval predicate, used as a policy

`requireApproval` accepts a per-tool predicate receiving
`{ session, toolName, toolInput, approvedTools, callId }`. Two of its return
values resolve without a human:

- `'not-applicable'`: runs immediately, no prompt
- `{ type: 'denied', reason }`: refused server-side, uncontestable by any comment

That is enough to build the whole gate today:

```ts
const tier = (s) => s.auth.current?.attributes?.tier
const trusted = (s) => s.auth.current?.attributes?.threadTier === 'admin'
const DENY = { type: 'denied', reason: 'Only repository maintainers can ask Evi to do that.' }

requireApproval: {
  // Reversible, so no prompt — but only on a thread a maintainer opened. See
  // "Why admin is not simply allowed everything" for why provenance matters.
  addLabels: ({ session }) =>
    tier(session) !== 'admin' ? DENY : trusted(session) ? 'not-applicable' : 'user-approval',
  createPullRequest: ({ session }) => tier(session) === 'admin' ? 'user-approval' : DENY,
  // …
}
```

That means `onComment` stamps two values, not one: the caller's tier, and the
tier of whoever opened the thread. The second is what stops a maintainer's
mention on an attacker's issue from running frictionless.

`toolName` arrives namespaced (`github__addLabels`), so match with `.endsWith()`
rather than `===` if you write a single catch-all predicate instead of per-tool
entries.

**Denying every write for the public tier does not stop Evi answering them.** Her
reply is posted by the channel, not by a tool; `addIssueComment` is only for
commenting somewhere *other* than the current thread. A public user still gets a
full grounded answer.

## What admin runs without being asked

Reversible only, and only on a thread a maintainer opened. On any other thread
this list keeps its approval too, for the reason below:

`addIssueComment`, `updateIssueComment`, `addPullRequestComment`,
`updatePullRequestComment`, `addIssueReaction`, `addCommentReaction`,
`addLabels`, `removeLabel`, `addAssignees`, `removeAssignees`,
`addDiscussionComment`.

`requestReviewers` is approval-free on every kind of run, not only admin:
requesting a review is reversible and grants nothing, and the instructions
require it on every non-draft PR.

Everything else keeps a real approval even for admin: `createIssue`, `closeIssue`,
`deleteIssueComment`, `deletePullRequestComment`, `createPullRequest`,
`updatePullRequest`, `createPullRequestReview`. Code itself never moves through
the API: it ships from the sandbox via `git__push`, which is only mounted on
maintainer sessions.

Release writes are not on the list at all: `AGENTS.md` forbids an agent from
creating one, so the tool set stops at reading them.

And "reversible" is about the repository record, not about side effects. A
comment triggers `issue_comment` workflows and notifies watchers; deleting it
afterwards undoes neither. On a thread opened by someone outside the tier, treat
that as a reason to keep even the reversible list behind approval.

One trap in that split: **`updateIssue` also sets `state`**, so auto-approving it
also grants `closeIssue`, since supplying `state` closes the issue. Gate on the
input, not the tool name:

```ts
updateIssue: ({ session, toolInput }) => {
  if (tier(session) !== 'admin') return DENY
  return toolInput?.state === undefined ? 'not-applicable' : 'user-approval'
},
```

## Why admin is not simply allowed everything

Once Evi has write tools and reads issue bodies, comments, and source written by
other people, a prompt injection is just a well-crafted issue body.

The tier gate stops an attacker escalating *themselves*. It does not stop the case
that matters: **a maintainer mentions Evi on an issue an attacker wrote.** The
session then runs at admin tier while reading attacker-controlled text, and the
elevation came from the maintainer, not the attacker. That is why "admin means no
friction" is not tenable, and why the auto-approve list stops at reversible
actions. The blast radius of a successful injection should be a comment someone
deletes, never a force-push or a release.

Worth revisiting once there is real traffic: marking content provenance (was this
thread opened by someone outside the tier?) and lowering the ceiling on those
threads regardless of who is asking.

## Autonomous turns need their own principal

`onIssue`, `onPullRequest`, and `onCheckSuite` all dispatch with
`defaultGitHubAuth(ctx)`, where the sender is whoever opened the issue or pushed
the commit. An automated CI-triage turn would therefore run under a random
contributor's identity, and, with the tier logic above, under their permissions.

Agent-initiated work needs a constructed system principal instead, at a tier
chosen for the task rather than inherited from whoever tripped the webhook. It
should generally be *lower* than admin: nobody is watching, and there is nobody to
approve anything, so it should only reach tools that are safe unattended.

## The gap in @github-tools/eve-extension

Everything above enforces at the approval layer, which means every tool still sits
in every caller's context (schemas cost roughly 7k tokens per turn for the
maintainer surface), and a denied call burns a model step to learn it was refused.

The clean fix is a tool surface that varies per caller. The extension already
resolves tools inside a dynamic resolver on `step.started`, and simply ignores the
context eve hands it. If `include` / `exclude` / `preset` accepted a resolver of
that context alongside a static value, an agent could hand admins the full surface
and everyone else the read-only one, with the schemas to match. Worth proposing
upstream: it is useful to any agent on a public repository, not just this one.

## Still open

- Whether a middle tier (org member, prior contributor) earns anything, or whether
  admin/public is enough. Start with two; a third is easy to add later.
- Rate limiting is a separate concern and still unsolved: it needs a store that
  outlives a session, which `defineState` is not.
- No eval covers the tier gate yet. `safety/write-requires-approval` already
  covers approval parking, but nothing asserts that a public caller is refused,
  or that an approval came from the maintainer who triggered the turn rather than
  whoever replied first.
