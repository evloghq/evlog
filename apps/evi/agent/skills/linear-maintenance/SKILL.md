---
name: linear-maintenance
description: "Bi-weekly housekeeping pass over the evlog team's Linear backlog: labels, projects, priorities, stale triage, work that is done but still open, and anything misfiled next to its siblings. Applies the mechanically verifiable fixes and surfaces the rest as decisions. Load this when the linear-maintenance schedule fires, or when Hugo asks for a Linear clean-up, a backlog pass, or a triage consistency check."
---

# Linear maintenance

A regular housekeeping sweep over the evlog team's Linear backlog so it stays
readable and current between passes. The goal is a tidy, trustworthy backlog,
not a census. Listing every issue is not the point; correcting the drift and
flagging what needs a decision is.

Where the other skills draw the line: `self-review` owns the coherence and
reach of the agent's own surface, `repo-health-sweep` owns the repository and
docs, `cost-watchdog` owns gateway spend. This skill owns Linear housekeeping
only, and stops there. When a pass finds evidence that shipped work is now
live (a schedule, a skill, a merged PR), the finding belongs to this skill's
"close it" bucket, not to building anything.

## Two halves, in order

**Apply** what is mechanically verifiable. These are the unambiguous fixes,
and they are the point of the run: the sibling set or the issue history is
evidence enough that a write is correct. Apply them directly via
`linear__save_issue`.

**Surface** what needs a judgement call about intent. Anything you cannot
verify, or whose correct value is a matter of taste, stays open and is written
down as a finding for Hugo. Never guess a decision that a sibling set or the
issue history cannot support.

## The lenses

Enumerate the open surface first: `linear__list_issues` on the evlog team,
across states. Then for each item check:

- **Project**: every open issue sits in the project its title and content
  point to, or in `Triage` if it is genuinely unplaced. An issue whose peers
  carry a project but it does not is a fix, not a finding.
- **Priority**: an item `In Progress` should carry a priority consistent with
  its siblings; a `Backlog` item with no priority next to prioritized peers is
  inconsistent. A priority change that relies on an estimate of intent is a
  finding.
- **Label**: every open issue carries one of the team's labels. A feature
  request with no label is a fix. A label that duplicates another, or has a
  single use, is a hygiene finding.
- **Stale**: triage older than several months with no movement, parked next to
  a canceled sibling, or an investigation that outlived its question, is a
  finding (close it or kick it to the community).
- **Done but open**: an item whose work already shipped in another issue, a
  schedule, or a merged PR, and is still open, is a close. Only when the
  shipped evidence is verifiable from the issue history or linked work.
- **Consistency**: a true duplicate of a completed or archived sibling, a
  sub-issue misread as a duplicate, work whose state contradicts its neighbors.

## Grounding

- **Absence is proven by listing, never by recall.** Before writing that a
  project, label or priority is missing, enumerate the real surface with
  `linear__list_issues` and the label list. A value you do not remember seeing
  is not a value that is absent.
- **Run before you assert.** A "this is shipped" close is grounded in the
  issue history, a linked PR, or a live schedule that the issue thread or the
  repo confirms. If it could not be verified, it is a finding written as a
  question, not a close.
- **One counter-example kills a claim of inconsistency.** Check the sibling
  set in the same project and state before declaring something misfiled.

## Deliver

The report is a Linear document per run: the fixes already applied, and the
open decisions each with the evidence and the question to resolve. Post one
line per artifact to the thread, links inline. Then stop; do not read the
report back to confirm it.

- **Mechanical fix, unambiguous → apply it** with `linear__save_issue` and
  list it in the report under "applied".
- **Decision → a finding** in the report under "left open", naming the
  evidence and the exact call to make. A finding that needs a decision Hugo
  has not asked you to take stays open; do not close it unilaterally.

Never invent a fix to fill the run, and never report a lens as clean when it
ran and found nothing of note. A quiet pass is a real result: one line saying
so.
