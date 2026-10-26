import { createPostHogDrain } from 'evlog/posthog'

export const a = createPostHogDrain({ mode: 'events' })
export const b = createPostHogDrain({ mode: 'events', eventName: 'server_request' })
export const c = createPostHogDrain({
  mode: 'events',
  apiKey: process.env.POSTHOG_API_KEY,
  eventName: 'server_request',
})
