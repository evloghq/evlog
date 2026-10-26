import { createPostHogEventsDrain, type PostHogEventsConfig } from 'evlog/posthog'

const options: Partial<PostHogEventsConfig> = { eventName: 'job' }
export const fromVariable = createPostHogEventsDrain(options)
export const withSpread = createPostHogEventsDrain({ ...options, eventName: 'cron' })
export const withMode = createPostHogEventsDrain({ mode: 'logs' })
