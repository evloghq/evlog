import { createPostHogEventsDrain } from 'evlog/posthog'

const factories = { events: createPostHogEventsDrain }
export const drain = factories.events()
export { createPostHogEventsDrain }
