import { createPostHogEventsDrain as events } from 'evlog/posthog'
import * as posthog from 'evlog/posthog'

export const a = events({ eventName: 'a' })
export const b = posthog.createPostHogEventsDrain()
