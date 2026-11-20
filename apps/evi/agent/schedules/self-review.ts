import { defineSchedule } from 'eve/schedules'
import slack from '../channels/slack'
import { maintainerRun } from '../lib/schedule'

export default defineSchedule({
  cron: '0 8 * * 3',
  run: maintainerRun(slack, 'Self review', 'Load the self-review skill and run both halves over the repository and your own surface: what has drifted out of coherence, and what capability is missing. Open ready PRs for mechanical fixes that clear the full readiness gate, request the code owners as reviewers after CI passes, and use Linear for findings or proposals that need a decision.'),
})
