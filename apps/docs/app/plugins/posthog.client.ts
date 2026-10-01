import posthog, { type CaptureResult } from 'posthog-js'

/**
 * Uncaught errors from browser extensions surface through `capture_exceptions`
 * even though the site does not own that injected code. A stack frame served
 * over one of these schemes is one tell; an extension-only API named in the
 * message is the other, and the only one when the error carries no frames.
 */
const EXTENSION_FRAME_SCHEMES = ['chrome-extension://', 'moz-extension://', 'safari-web-extension://']
const EXTENSION_API_MARKERS = ['runtime.sendMessage', 'chrome.runtime', 'browser.runtime']

function isExtensionException(properties: CaptureResult['properties']): boolean {
  const exceptions = properties?.$exception_list
  if (!Array.isArray(exceptions)) return false

  return exceptions.some((exception) => {
    const frames = exception?.stacktrace?.frames
    if (Array.isArray(frames) && frames.some((frame) => EXTENSION_FRAME_SCHEMES.some((scheme) => frame?.filename?.startsWith(scheme)))) {
      return true
    }
    const message = `${exception?.type ?? ''} ${exception?.value ?? ''}`
    return EXTENSION_API_MARKERS.some((marker) => message.includes(marker))
  })
}

/**
 * Cookie-based tracking for every visitor: session replay, surveys and full
 * heatmaps run without a consent step. Session replay itself waits for the
 * project's remote config, so it starts only when enabled in the PostHog
 * project settings.
 */
export default defineNuxtPlugin(() => {
  const key = useRuntimeConfig().public.posthogKey
  if (!key) return

  posthog.init(key, {
    // Ingestion through the site's own origin; blockers drop the PostHog one.
    api_host: '/_ph',
    ui_host: 'https://eu.posthog.com',
    // Carries `capture_pageview: 'history_change'`, so posthog-js already
    // captures every SPA navigation. A router hook on top of it counts each
    // page twice.
    defaults: '2026-05-30',
    // Off in the local dev server: a Vite module error or any other dev-only
    // failure must not ship to the same error tracking project as production.
    capture_exceptions: !import.meta.dev,
    // Drop uncaught exceptions thrown by browser extensions on the page; they
    // are not the site's code and only add noise to error tracking.
    before_send: (event) => {
      if (event?.event === '$exception' && isExtensionException(event.properties)) return null
      return event
    },
  })
})
