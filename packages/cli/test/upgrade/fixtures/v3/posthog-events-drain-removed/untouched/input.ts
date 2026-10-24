// createPostHogEventsDrain was replaced by events mode in 2.x already.
import { createPostHogDrain, sendToPostHogEvents } from 'evlog/posthog'

export const drain = createPostHogDrain({ mode: 'events' })
export { sendToPostHogEvents }
