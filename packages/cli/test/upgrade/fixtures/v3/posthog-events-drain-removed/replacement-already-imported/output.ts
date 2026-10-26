import { createPostHogDrain } from 'evlog/posthog'

export const drains = [createPostHogDrain(), createPostHogDrain({ mode: 'events', eventName: 'x' })]
