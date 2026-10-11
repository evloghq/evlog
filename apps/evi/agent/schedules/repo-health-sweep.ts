import { defineSchedule } from 'eve/schedules'
import slack from '../channels/slack'
import { maintainerRun } from '../lib/schedule'

export default defineSchedule({
  cron: '0 8 * * 2,5',
  run: maintainerRun(slack, 'Repo health sweep', 'Load the repo-health-sweep skill, read only the compact ledger `apps/evi/agent/ledgers/repo-health-sweep.md`, choose bounded code, test, architecture, and communication cohorts, search `apps/evi/agent/ledgers/repo-health-sweep-rejected.jsonl` with rg for the scoped paths and areas, open an archive file only for a specific detail, then call simplification-sweep once. Read its reviewer health and exact counts before the findings. Reproduce every workflow-confirmed candidate against current main, and call nothing PR-ready before that parent verification passes. Open at most three ready PRs, one per batch of same-kind fixes that clears the full readiness gate, request Hugo as reviewer after CI passes, and record the run through its own ready PR that rewrites the compact ledger, appends one section to the archive file of the current month, and appends new rejected findings to the rejected file.'),
})
