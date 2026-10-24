import { createPostHogDrain, createPostHogEventsDrain } from 'evlog/posthog'

export const drains = [createPostHogDrain(), createPostHogEventsDrain({ eventName: 'x' })]
