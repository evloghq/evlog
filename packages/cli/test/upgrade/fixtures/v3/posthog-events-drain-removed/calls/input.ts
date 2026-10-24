import { createPostHogEventsDrain } from 'evlog/posthog'

export const a = createPostHogEventsDrain()
export const b = createPostHogEventsDrain({ eventName: 'server_request' })
export const c = createPostHogEventsDrain({
  apiKey: process.env.POSTHOG_API_KEY,
  eventName: 'server_request',
})
