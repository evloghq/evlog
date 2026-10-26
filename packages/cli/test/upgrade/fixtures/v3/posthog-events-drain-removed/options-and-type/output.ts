import { createPostHogDrain, type PostHogConfig } from 'evlog/posthog'

const options: Partial<PostHogConfig> = { eventName: 'job' }
export const fromVariable = createPostHogDrain({ ...options, mode: 'events' })
export const withSpread = createPostHogDrain({ ...options, eventName: 'cron', mode: 'events' })
export const withMode = createPostHogDrain({ mode: 'events' })
