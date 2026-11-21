import { noReply } from 'eve/tools/no_reply'

// Lets Evi stay quiet in a followed Slack thread when a reply isn't for it (`channels/slack.ts`),
// and lets a task scheduled from Slack (`schedules/tasks.ts`) skip posting when it has nothing to report.
export default noReply
