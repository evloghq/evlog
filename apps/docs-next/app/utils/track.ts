import type { PostHog } from 'posthog-js'

let client: PostHog | undefined

/**
 * Hand the initialized PostHog instance to `trackEvent`. Called by the
 * PostHog plugin once the SDK has loaded after hydration.
 */
export function setPostHogClient(instance: PostHog): void {
  client = instance
}

/**
 * Capture a product analytics event. A no-op on the server, when PostHog
 * did not initialize (no key configured, e.g. local dev), and before the SDK
 * has loaded.
 */
export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  if (!import.meta.client || !client?.__loaded) return
  client.capture(event, properties)
}
