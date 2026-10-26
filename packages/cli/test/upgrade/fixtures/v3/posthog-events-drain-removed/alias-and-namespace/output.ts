import { createPostHogDrain as events } from 'evlog/posthog'
import * as posthog from 'evlog/posthog'

export const a = events({ mode: 'events', eventName: 'a' })
export const b = posthog.createPostHogDrain({ mode: 'events' })
