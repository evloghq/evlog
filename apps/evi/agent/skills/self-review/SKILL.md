---
name: self-review
description: Weekly pass over the evlog repository and Evi's own surface, in two halves: what has drifted out of coherence (a capability wired but never consumed, code contradicting a written guide, a description promising a tool the allowlist lacks), and what is missing (a capability worth having, a manual step worth automating, a gap in evlog users keep hitting). Load this when the self-review schedule fires, or when Hugo asks for a self-review, an audit, ideas for what Evi should do next, or what is inconsistent in the repo.
---

# Self review

Two halves, run together, because they fail in opposite directions.

**Coherence** is what drifted: two halves built at different times that never met, a rule the code stopped obeying, a description that outran its tools. Nothing is broken, no test fails, nobody files it.

**Reach** is what is missing: a capability the platform now offers and this agent never adopted, a step you have done by hand three weeks running, a hole in evlog that users keep walking into. Nothing is wrong, so nothing prompts it.

Skipping the second half turns this run into a regression sweep. Skipping the first turns it into a wishlist. Run both.

## Two kinds of output, two bars

A **finding** contradicts something written down or something declared: a rule in a guide, a capability the app announces, a description that promises behavior the tools do not deliver. Name the prose or the declaration it contradicts, or drop it.

A **proposal** is a capability worth having that nothing yet argues for. It needs an observation, not a contradiction: the friction you hit, the tool that shipped, the request that came back a third time. Name what you observed and when, or drop it.

Neither bar is met by taste. "I would have written this differently" is not a finding, and "this would be cool" is not a proposal. Both are refusals to do the work of grounding.

---

# Part one: coherence

## A. Wiring gaps

Something is produced and nothing consumes it. For each connection, extension and channel under `agent/`, ask what it puts into a session or returns to the model, then grep for a consumer.

- Context blocks eve injects, session `state`, channel metadata. `issue_identifier` sat in every delegated Linear session for weeks before anything read it (#555).
- Values computed in `agent/lib/` and returned to no one.
- The inverse: an `agent/lib/` module with a colocated test and no import outside that test.

## B. Guides the code stopped obeying

| Guide | Check |
| --- | --- |
| Root `AGENTS.md` | A new entrypoint registered in all three of `package.json#exports`, `package.json#typesVersions`, `tsdown.config.ts`. No `evlog/shared` import (`evlog/toolkit` is the public name). No HTML comment in a Vue `<template>`. |
| Root `AGENTS.md` | Every first-class framework integration exposes the same contract: `evlog()`, `useLogger()`, `log.fork()`. Guide-level integrations (Astro, AWS Lambda) document the generic API instead, and `evlog/workers` is the documented exception. |
| `apps/evi/docs/capability-placement.md` | The two-layer rule: a file under `agent/` outside `agent/lib/` holding logic instead of wiring, an `agent/lib/` module with no colocated `*.test.ts`, or a caller check written inline instead of going through `agent/lib/trust.ts`. |
| `packages/evlog/test/README.md` | A framework test driving the app by hand instead of through its real request driver. |
| Root `AGENTS.md` | A behavior change whose matching `.agents/skills/` or `skills/` SKILL.md still describes the old shape. |

## C. Prose that outran the tools

Read the strings the model actually sees against the tools it actually has.

- Each `agent/connections/*.ts`: does the `description` name a capability the `tools.allow` list omits?
- Each `agent/skills/*/SKILL.md` and `agent/instructions.md`: every tool name mentioned must exist. A skill pointing at an unreachable tool fails silently at the worst moment.
- Every output destination `instructions.md` names must be writable from the posture that reads it.

## D. Production signals

Read-only, and these become issues, never PRs.

- `telemetry-stats`: an error code climbing week over week, a command whose success rate is falling.
- CI on `main`: a job failing intermittently is a finding even when the reruns go green.
- `vercel__get_runtime_errors` (production): a runtime error cluster growing week over week, or one whose route has no docs page explaining it, is a docs proposal with a number attached.
- Evi's own production runs: `vercel__list_agent_run_projects` to find the eve service project, then `vercel__list_agent_runs` for sessions that ended badly or never answered and the failed tool calls inside them. Drill into a failure with `vercel__get_runtime_logs`.

---

# Part two: reach

## E. Capability the platform gained

The frameworks under this agent ship faster than it adopts them.

- `eve registry search <query>` and `eve registry list`: integrations that exist and are not installed. Read one with `eve registry view <item>` before proposing it. The repo rule is to check the registry before building an integration by hand, so a hand-rolled tool duplicating a registry item is both a proposal and a finding.
- Connections already wired whose server grew: a Linear, Vercel or telemetry tool that did not exist when the allowlist was written.
- `upstream-sync` owns version bumps and workaround removal. This lens is about capabilities never adopted, not versions behind. When the two overlap, leave it to that skill.

## F. Surface already paid for and unused

The cheapest new capability is one already connected.

- A tool in a `tools.allow` list that no skill and no instruction ever tells Evi to call. Either a workflow is missing or the entry is, and both are worth saying out loud.
- Objects a connected service offers that Evi never touches: Linear milestones and status updates, Vercel analytics dimensions, telemetry breakdowns that no skill reads.
- A schedule that could carry work it does not: the digest already gathers numbers that another skill re-fetches.

## G. The step that keeps repeating

The strongest proposals come from your own friction, and it is only visible from the inside.

- A sequence you have run by hand more than twice across sessions is a skill waiting to be written. That is the cheapest capability in `capability-placement.md` and needs no code.
- A question Hugo asked in three different weeks is a skill or a schedule.
- A turn where you lacked a tool and worked around it, or read fifteen files to answer one question, is evidence for a tool or a subagent. `capability-placement.md` states the observed trigger for a subagent; cite it or do not propose one.

## H. Where evlog itself falls short

Look outward, not only at the agent.

- `telemetry-adoption`: a flag or custom field nobody uses two releases in is a deprecation candidate; a custom field spreading on its own is a workflow worth making first-class.
- The top error code from `telemetry-stats` with no docs page covering it is a docs proposal with a number attached.
- Community issues and discussions asking for the same integration, adapter or option a third time.
- A docs lookup that came up empty during a session: it usually means a page is missing.

## I. Ideas already written down and never filed

The repo carries proposals nobody turned into work.

- `apps/evi/docs/notes.md`, section **Open**.
- `apps/evi/docs/observability.md`, section **Proposals**.

These are pre-grounded: someone already did the reasoning. An entry that still holds and has no issue is the easiest proposal of the run. One that no longer holds should be deleted from the doc, which is a finding.

---

# Grounding

The failure mode of this run is a confident output that is wrong, and the expensive version is claiming something does not exist.

- **Absence is proven by listing, never by recall.** Before writing that a tool, option, field or export is missing, enumerate the real surface: `connection_search` for a connection's tools, the file for an exports map, the docs index for a page, `eve registry list` for an integration. A name you do not remember seeing is not a name that is absent.
- **Never describe a check you did not run.** If you could not verify something, say so in those words and file it as a question. It never enters a PR body as evidence.
- **One counter-example kills a finding.** Before filing "nothing consumes X", grep the whole repo for X, not just the directory you were reading.
- **A proposal names its cheapest form.** Walk `capability-placement.md` in order and say which rung it lands on and why not the one above. A proposal that arrives as "we should build a tool for this" without that walk is not ready.

## Dedupe

Before filing anything: `linear__list_issues` on the evlog team, and `github__searchIssues` for an open issue or PR on the same ground, including your own drafts from earlier runs. A stale draft that still applies gets a rebase and a comment, not a replacement. A finding or proposal Hugo closed once does not come back: the decision was made.

## Deliver

**Mechanical fix, checks green, no judgement needed → draft PR.** One per finding, never bundled. Follow `contributing`: branch off `main` in `/workspace/repo`, run `pnpm run lint`, `pnpm run typecheck` and `pnpm run test`, add a changeset when the change touches a published package (an `apps/evi` change never needs one). The PR body names the guide or the declared capability the code contradicted.

**Everything else → Linear issue** via `linear__save_issue` on the evlog team. A finding states the problem, what it contradicts, where it is, and the decision to make. A proposal states the observation that triggered it, what the capability would do, the rung of `capability-placement.md` it lands on, and what it costs. Label the two apart so the backlog stays readable.

**A proposal never ships as code on your own initiative.** The repo forbids speculative code, and an unrequested capability is exactly that. The issue is the deliverable; building it is Hugo's call.

Cap a run at three draft PRs and two proposals: the two you would defend, not everything that came to mind. Anything past the cap is named in the summary with a count, so a heavy week is visible rather than silently trimmed.

Then post one line per artifact to the thread, links inline.

## When nothing is warranted

One line: the lenses ran and nothing came up. Never invent a finding to fill the run, never file an issue to report that a lens was clean, and never open a PR for a rule the repo does not actually state. A quiet week is a real result, and both halves are allowed to be quiet.
