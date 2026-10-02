import { runAgentBrowser, type EveSandboxSession, type EveToolContext } from '@agent-browser/eve/sandbox'
import type { SandboxSession } from 'eve/sandbox'
import { eviErrors } from './errors'

/**
 * Single source of truth for where the browser — and any capture — may go:
 * evlog's own surfaces, Vercel previews, and sandbox-local dev servers. The
 * agent-browser matcher accepts exact hosts and `*.suffix` wildcards only.
 */
export const ALLOWED_BROWSER_DOMAINS = [
  'evlog.dev',
  '*.evlog.dev',
  'evlog.cloud',
  '*.evlog.cloud',
  '*.vercel.app',
  'localhost',
  '127.0.0.1',
] as const

export const CAPTURE_VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
} as const

export type CaptureViewport = keyof typeof CAPTURE_VIEWPORTS

/** Entrance animations and font swaps settle before the frame is taken. */
export const CAPTURE_SETTLE_MS = 5000

/**
 * Attribute the capture stamps on the resolved element, so the scroll can
 * address it by selector even when the page offers nothing stable to select.
 * It exists for the length of one capture and never reaches the repository.
 */
export const CAPTURE_MARK = 'data-evi-capture'

/** What the target resolved to, or what the page offered instead. */
export interface TargetProbe {
  readonly found: boolean
  /** How the element was located, for the attestation receipt. */
  readonly how: 'selector' | 'text' | null
  /** `data-section` hooks on the page, offered when nothing resolved. */
  readonly hooks: readonly string[]
  /** Headings on the page, offered when nothing resolved. */
  readonly headings: readonly string[]
}

export interface CaptureTarget {
  readonly selector?: string
  readonly text?: string
}

/**
 * JavaScript that locates the element to frame and marks it. The selector is
 * tried first; otherwise the visible copy is searched and widened to its
 * nearest sectioning ancestor. The element is stamped with
 * {@link CAPTURE_MARK} rather than returned, so the scroll that follows can
 * use agent-browser's own `scrollintoview` (which handles scroll containers
 * and sticky headers a hand-rolled `window.scrollTo` gets wrong).
 */
export function resolveTargetExpression(target: CaptureTarget): string {
  const selector = JSON.stringify(target.selector ?? '')
  const text = JSON.stringify(target.text ?? '')
  return `(() => {
    const MARK = ${JSON.stringify(CAPTURE_MARK)}
    document.querySelectorAll('[' + MARK + ']').forEach(n => n.removeAttribute(MARK))
    const selector = ${selector}
    const text = ${text}
    let el = selector ? document.querySelector(selector) : null
    let how = el ? 'selector' : null
    if (!el && text) {
      const needle = text.trim().toLowerCase()
      const nodes = [...document.querySelectorAll('h1, h2, h3, h4, p, li, summary, button, a, figcaption')]
      const hit = nodes.find(n => (n.textContent || '').trim().toLowerCase().includes(needle))
      if (hit) {
        el = hit.closest('section, article, [data-section], [class*="not-prose"]') || hit
        how = 'text'
      }
    }
    if (!el) {
      const hooks = [...document.querySelectorAll('[data-section]')].map(n => n.getAttribute('data-section'))
      const headings = [...document.querySelectorAll('h1, h2')].map(n => (n.textContent || '').trim()).filter(Boolean)
      return { found: false, how: null, hooks: [...new Set(hooks)], headings: headings.slice(0, 12) }
    }
    el.setAttribute(MARK, '')
    return { found: true, how, hooks: [], headings: [] }
  })()`
}

/** Reads the agent-browser envelope returned by {@link resolveTargetExpression}. */
export function readTargetProbe(envelope: unknown): TargetProbe {
  const data = (envelope as { data?: unknown } | null | undefined)?.data
  if (data === null || typeof data !== 'object') {
    throw eviErrors.CAPTURE_PROBE_MISSING()
  }
  const probe = data as Record<string, unknown>
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  return {
    found: probe.found === true,
    how: probe.how === 'selector' || probe.how === 'text' ? probe.how : null,
    hooks: strings(probe.hooks),
    headings: strings(probe.headings),
  }
}

/** How the frame is described in the attestation receipt. */
export function describeTarget(target: CaptureTarget, how: TargetProbe['how']): string {
  if (how === 'text') return `text "${escapeInline(target.text ?? '')}"`
  if (how === 'selector') return escapeInline(target.selector ?? '')
  return 'full viewport'
}

/**
 * The error raised when nothing resolved. It names the hooks and headings the
 * page does offer, so the next attempt is a correction rather than a guess.
 */
export function unresolvedTargetMessage(target: CaptureTarget, probe: TargetProbe): string {
  const asked = [
    target.selector ? `selector "${target.selector}"` : null,
    target.text ? `text "${target.text}"` : null,
  ].filter(Boolean).join(' nor ')
  const offered = [
    probe.hooks.length > 0 ? `hooks: ${probe.hooks.map(hook => `[data-section="${hook}"]`).join(', ')}` : null,
    probe.headings.length > 0 ? `headings: ${probe.headings.map(heading => `"${heading}"`).join(', ')}` : null,
  ].filter(Boolean).join('; ')
  const available = offered === ''
    ? 'That page offers no hooks and no headings to locate one by.'
    : `That page offers ${offered}.`
  return `No ${asked} matched, so the capture would have framed the top of the page. ${available}`
}

/** Returns the refusal reason, or null when the URL may be captured. */
export function validateCaptureUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return `"${raw}" is not a valid absolute URL.`
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `"${raw}" must use http(s).`
  }
  const host = url.hostname.toLowerCase()
  const allowed = ALLOWED_BROWSER_DOMAINS.some(pattern =>
    pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern,
  )
  return allowed ? null : `"${host}" is outside the allowed capture origins.`
}

/**
 * Surfaces that can show real user data: captures of these publish only after
 * an explicit approval, whatever the skill says. evlog.cloud is the hosted
 * product and any telemetry host shows live dashboards.
 */
export function sensitiveCaptureReason(raw: string): string | null {
  const host = new URL(raw).hostname.toLowerCase()
  if (host === 'evlog.cloud' || host.endsWith('.evlog.cloud')) {
    return `${host} is the hosted product and can show real user data.`
  }
  if (host.includes('telemetry')) {
    return `${host} serves telemetry dashboards and can show real user data.`
  }
  return null
}

/**
 * One-line text safe inside the Markdown table and the <sub> receipt: line
 * breaks collapse, and the characters that could open HTML or break the
 * table are escaped.
 */
export function escapeInline(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
}

/** Normalized URL for Markdown embedding; parentheses would end the link early. */
export function markdownUrl(raw: string): string {
  return new URL(raw).toString().replaceAll('(', '%28').replaceAll(')', '%29')
}

interface AttestationInput {
  readonly afterUrl: string
  readonly beforeUrl: string
  readonly capturedAt: string
  /** How the frame was located, from {@link describeTarget}. */
  readonly frame: string
  readonly viewport: CaptureViewport
}

/** Human-readable receipt embedded under the comparison table. */
export function captureAttestation(input: AttestationInput): string {
  return `captured by agent-browser · ${markdownUrl(input.beforeUrl)} → ${markdownUrl(input.afterUrl)} · ${input.viewport} · ${escapeInline(input.frame)} · ${input.capturedAt}`
}

/** Frames land here before the Blob upload reads them back. */
export const SCREENSHOT_DIR = '/workspace/screenshots'

interface FrameRequest {
  readonly side: 'before' | 'after'
  readonly target: CaptureTarget | null
  readonly url: string
  readonly viewport: CaptureViewport
}

/**
 * The per-frame capture sequence: set the viewport, open the page, settle,
 * resolve the target, scroll it into view, screenshot. Raises
 * CAPTURE_TARGET_UNRESOLVED with the page's own hooks and headings when the
 * target matches nothing, so the next attempt is a correction.
 */
export async function captureFrame(
  ctx: EveToolContext,
  { side, target, url, viewport }: FrameRequest,
): Promise<{ path: string, how: 'selector' | 'text' | null }> {
  const { width, height } = CAPTURE_VIEWPORTS[viewport]
  const path = `${SCREENSHOT_DIR}/${side}-${Date.now()}.png`
  await runAgentBrowser(ctx, ['set', 'viewport', String(width), String(height)])
  await runAgentBrowser(ctx, ['open', url])
  await runAgentBrowser(ctx, ['wait', String(CAPTURE_SETTLE_MS)])
  if (target === null) {
    await runAgentBrowser(ctx, ['screenshot', path])
    return { path, how: null }
  }
  const probe = readTargetProbe((await runAgentBrowser(ctx, ['eval', resolveTargetExpression(target)])).json)
  if (!probe.found) throw eviErrors.CAPTURE_TARGET_UNRESOLVED({ message: unresolvedTargetMessage(target, probe) })
  await runAgentBrowser(ctx, ['scrollintoview', `[${CAPTURE_MARK}]`])
  await runAgentBrowser(ctx, ['wait', '500'])
  await runAgentBrowser(ctx, ['screenshot', path])
  return { path, how: probe.how }
}

/**
 * agent-browser still expects the pre-0.64 eve session shape, an `id` beside
 * `run`; it only uses the id to name the browser session, so any stable
 * string stands in.
 */
export function browserSandbox(sandbox: Pick<SandboxSession, 'run'>, id: string): EveSandboxSession {
  return { id, run: options => sandbox.run(options) }
}

export function browserContext(sandbox: Pick<SandboxSession, 'run'>, id: string): EveToolContext {
  const session = browserSandbox(sandbox, id)
  return { getSandbox: () => Promise.resolve(session) }
}

/** The finished markdown block: table, caption, attestation receipt. */
export function captureMarkdown(input: AttestationInput & {
  readonly afterImageUrl: string
  readonly beforeImageUrl: string
  readonly caption: string
}): string {
  return [
    '| Before | After |',
    '| --- | --- |',
    `| ![before](${markdownUrl(input.beforeImageUrl)}) | ![after](${markdownUrl(input.afterImageUrl)}) |`,
    '',
    escapeInline(input.caption),
    '',
    `<sub>${captureAttestation(input)}</sub>`,
  ].join('\n')
}
