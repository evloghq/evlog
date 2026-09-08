# Choosing where a capability lives in Evi

Evi is a vertical agent: one domain (evlog), one repository, one maintainer. The
root surface carries everything today, and that is correct at this size. The
discipline is in *how* each capability is expressed, so the surface stays
readable as it grows.

Use this order when placing a new capability:

1. If the model only needs an optional procedure for capabilities it already
   has, write a **skill** (`agent/skills/<id>/SKILL.md`). Cheapest, no code.
2. If work must start on a cadence, add a **schedule** (`agent/schedules/`)
   that sends a prompt into the right channel; the prompt's procedure belongs
   in a skill the agent loads, not in the schedule file.
3. If the capability is a remote API the model should call directly, prefer a
   **connection** (`agent/connections/`) with an explicit `tools.allow` list
   over hand-written fetch tools.
4. Write an authored **tool** (`agent/tools/`) only when the operation needs
   Evi-side logic a connection cannot express: credential brokering, gating,
   response shaping. Gate visibility with `defineDynamic` +
   `agent/lib/trust.ts` rather than checking inside `execute` alone.
5. Reach for a **subagent** only at the trigger below. Do not create one to
   make the tree look cleaner.

## The two-layer rule

Every code file under `agent/` outside `agent/lib/` is wiring: it declares a
channel, tool, schedule, instruction fragment, or connection, and imports its
logic from `agent/lib/`. Skills (`agent/skills/*/SKILL.md`) and the core
`instructions.md` are authored prose, not code; they live where eve discovers
them and have no `agent/lib/` counterpart. Logic lives in `agent/lib/<domain>/` (or a flat
module while a domain has only one), in small single-purpose functions, each
with a colocated `*.test.ts`. A module stays flat until its domain has a
second file; then the domain gets a directory (`agent/lib/github/` was the
first).

Authority is expressed once, in `agent/lib/trust.ts` (`isMaintainer`,
`isAutonomous`, `canAccessAdminTools`), and referenced everywhere else. A new
capability never invents its own caller check.

## Instructions

`agent/instructions.md` holds only what every session needs: identity, voice,
the retrieval rules, response depth. Anything conditional on the channel or
the caller posture is a dynamic fragment in `agent/instructions/*.ts`
(`workspace.ts`, `first-responder.ts`), injected at `turn.started`. When a
section of the core file starts with "on this channel" or "when unattended",
it belongs in a fragment.

## When a subagent becomes justified

The trigger is observed, not aesthetic: interactive GitHub, Slack or iMessage
sessions blowing up in input tokens or losing the thread because deep repo
research (dozens of files read to answer one question) shares their context.
At that point, add a local `repo-research` subagent: isolated context, the
sandbox file tools only, optionally a cheaper model, returning a synthesized
answer. Nothing else about Evi's routing changes.

A second, later trigger is an independent authority boundary: a capability
whose credentials, failure modes, or release cadence should not move with Evi.
None exists today.

A third trigger is now in use, and it is the one the content pass hit: a task
whose correctness depends on two parties not sharing a context. `content_review`
and `content_rewrite` exist as separate subagents because a reviewer that can
edit talks itself into changes it cannot justify, and a writer that has read the
review's reasoning rewrites to that reasoning instead of to the page. The
conversation isolation keeps the roles separate. `agent/lib/content-sandbox.ts`
explicitly selects `parent.sandbox` through eve's callback API, so both agents
read the parent's branch and uncommitted pages without cloning another checkout.
They must not add sandbox seeds or packaged skills, which eve disallows for a
shared workspace. The parent captures a page identity with `content_snapshot`;
the child uses `content_load` to verify its digest and source commit. Both tools
are read-only. The writer returns proposed text and its input identity. The
parent waits for readers to finish, checks that identity again, and applies
reviewed changes serially with its existing editing tools. It then captures the
saved file and requests a fresh review before publishing. These instructions
coordinate Evi's edits; the snapshot check does not make writes atomic against
another process. Concurrent external editing requires coordination before Evi
continues. No custom write transaction or persistent lock is introduced.
Logic and local Git regression tests live in `agent/lib/content/handoff.ts` and
its colocated test, including rejection of stale snapshots after parent edits.
`content-sandbox.test.ts` verifies that both declared agents select the parent.
Their shell and file-write tools are disabled; `glob`, `grep` and `read_file`
support source inspection. The parent executes examples and applies rewrites.
Scans have a 30-second deadline and clean their staged passages through the
sandbox file API even when no shell exit event arrives. If both scanning and
cleanup fail, an aggregate error retains both failures and the original cause. Executable eval fixtures
run in a child process with a 10-second timeout and forced termination.

## Review checklist

Before adding a capability, answer in the PR:

1. Skill, schedule, connection, tool, or subagent — and why not the cheaper
   one above it?
2. Which `trust.ts` gate applies, and what does an autonomous turn see?
3. Where does the logic live in `agent/lib/`, and where is its test?
4. Which skill or instruction fragment documents it, updated in the same PR?
