import type { DrainContext, WideEvent } from '../types'
import { httpPost } from './http'

/**
 * Drain definition backed by an arbitrary `send` function. Use this for
 * non-HTTP transports (filesystem, in-memory queue, native SDK). For HTTP
 * backends, use `defineHttpDrain` instead.
 */
export interface DrainOptions<TConfig> {
  /** Stable identifier used in error logs. */
  name: string
  /** Return `null` to skip draining (e.g. missing API key in dev). */
  resolve: () => TConfig | null | Promise<TConfig | null>
  send: (events: WideEvent[], config: TConfig) => Promise<void>
  /**
   * Variant of `send` used by {@link DrainFn.raw}. Defaults to `send`. HTTP
   * drains use it to skip internal retries when the caller owns retrying.
   */
  rawSend?: (events: WideEvent[], config: TConfig) => Promise<void>
}

/**
 * Drain callback returned by {@link defineDrain} / {@link defineHttpDrain}.
 *
 * Calling it delivers the events and swallows failures (logged with the drain
 * name), so a failing drain never breaks the request pipeline. `raw` is the
 * throwing variant for callers that own failure handling themselves.
 */
export interface DrainFn {
  (ctx: DrainContext | DrainContext[]): Promise<void>
  /**
   * Deliver the events and reject on failure. Skips the drain's internal
   * retries unless retries are explicitly configured, so a wrapping layer
   * owns them. `createDrainPipeline` picks this up automatically: its `retry`
   * and `onDropped` options observe real failures instead of the swallowing
   * wrapper.
   */
  raw: (ctx: DrainContext | DrainContext[]) => Promise<void>
}

/**
 * Build a drain callback. Errors raised by `send` are logged with the drain
 * name and swallowed, so a failing drain never breaks the request pipeline.
 *
 * @example
 * ```ts
 * export function createMyDrain(overrides?: Partial<MyConfig>) {
 *   return defineDrain<MyConfig>({
 *     name: 'my-drain',
 *     resolve: () => ({ url: process.env.MY_URL ?? null }),
 *     send: async (events, config) => { ... },
 *   })
 * }
 * ```
 */
export function defineDrain<TConfig>(options: DrainOptions<TConfig>): DrainFn {
  async function deliver(ctx: DrainContext | DrainContext[], send: DrainOptions<TConfig>['send']): Promise<void> {
    const contexts = Array.isArray(ctx) ? ctx : [ctx]
    if (contexts.length === 0) return

    const config = await options.resolve()
    if (!config) return

    await send(contexts.map(c => c.event), config)
  }

  const drain = (async (ctx: DrainContext | DrainContext[]) => {
    try {
      await deliver(ctx, options.send)
    } catch (error) {
      console.error(`[evlog/${options.name}] Failed to send events:`, error)
    }
  }) as DrainFn
  drain.raw = ctx => deliver(ctx, options.rawSend ?? options.send)
  return drain
}

export interface HttpDrainRequest {
  url: string
  /** Caller is responsible for `Content-Type`. */
  headers: Record<string, string>
  body: string
  /** Compress `body` before sending and set `Content-Encoding`. */
  compression?: 'gzip'
}

/** Adapters only need to ship config + `encode()` — no manual `fetch`. */
export interface HttpDrainOptions<TConfig> {
  /** Stable identifier used in error logs. */
  name: string
  /**
   * Human-readable name prefixing HTTP error messages (`"Axiom API error: …"`).
   * Defaults to {@link HttpDrainOptions.name}. Set it to the same value the
   * adapter's standalone `sendBatchTo*` helper passes so both paths report a
   * failure identically.
   */
  label?: string
  /** Return `null` to skip draining (e.g. missing API key in dev). */
  resolve: () => TConfig | null | Promise<TConfig | null>
  /** Return `null` to skip the batch without raising. */
  encode: (events: WideEvent[], config: TConfig) => HttpDrainRequest | null
  /** @default 5000 */
  timeout?: number
  /** @default 2 */
  retries?: number
  /** Read the timeout off the resolved config (falls back to `timeout`). */
  resolveTimeout?: (config: TConfig) => number | undefined
  /** Read the retry count off the resolved config (falls back to `retries`). */
  resolveRetries?: (config: TConfig) => number | undefined
  /**
   * Inspect a successful response (e.g. to surface partial failures a 2xx can
   * still carry). Forwarded to {@link httpPost}.
   */
  onResponse?: (response: Response) => void | Promise<void>
}

const DEFAULT_HTTP_TIMEOUT = 5000

/**
 * POST an already-encoded {@link HttpDrainRequest} with the adapter's
 * timeout/retry defaults and evlog identity headers.
 *
 * Lets an adapter's standalone `sendBatchTo*` helper reuse the very same
 * encoder its `defineHttpDrain({ encode })` uses, instead of rebuilding the
 * URL, headers and body a second time.
 *
 * @example
 * ```ts
 * export async function sendBatchToMy(events: WideEvent[], config: MyConfig) {
 *   if (events.length === 0) return
 *   await sendEncodedDrainRequest(encodeMyRequest(events, config), {
 *     label: 'My', source: 'my', timeout: config.timeout, retries: config.retries,
 *   })
 * }
 * ```
 */
export async function sendEncodedDrainRequest(
  request: HttpDrainRequest,
  options: {
    label: string
    source: string
    timeout?: number
    retries?: number
    onResponse?: (response: Response) => void | Promise<void>
  },
): Promise<void> {
  await httpPost({
    url: request.url,
    headers: request.headers,
    body: request.body,
    compression: request.compression,
    timeout: options.timeout ?? DEFAULT_HTTP_TIMEOUT,
    retries: options.retries,
    label: options.label,
    source: options.source,
    onResponse: options.onResponse,
  })
}

/**
 * Build an HTTP drain. Timeouts/retries are resolved from the config (with
 * overrides via `resolveTimeout` / `resolveRetries`) and forwarded to
 * {@link httpPost}.
 *
 * @example
 * ```ts
 * export function createMyDrain(overrides?: Partial<MyConfig>) {
 *   return defineHttpDrain<MyConfig>({
 *     name: 'my',
 *     resolve: async () => {
 *       const cfg = await resolveAdapterConfig<MyConfig>('my', FIELDS, overrides)
 *       return cfg.apiKey ? cfg as MyConfig : null
 *     },
 *     encode: (events, config) => ({
 *       url: `${config.endpoint ?? 'https://api.my.com'}/ingest`,
 *       headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
 *       body: JSON.stringify(events),
 *     }),
 *   })
 * }
 * ```
 */
export function defineHttpDrain<TConfig>(options: HttpDrainOptions<TConfig>): DrainFn {
  function buildSend(fallbackRetries?: number) {
    return async (events: WideEvent[], config: TConfig): Promise<void> => {
      if (events.length === 0) return
      const request = options.encode(events, config)
      if (!request) return
      const timeout = options.resolveTimeout?.(config)
        ?? (config as { timeout?: number }).timeout
        ?? options.timeout
        ?? DEFAULT_HTTP_TIMEOUT
      const retries = options.resolveRetries?.(config)
        ?? (config as { retries?: number }).retries
        ?? fallbackRetries
      await httpPost({
        url: request.url,
        headers: request.headers,
        body: request.body,
        compression: request.compression,
        timeout,
        retries,
        label: options.label ?? options.name,
        source: options.name,
        onResponse: options.onResponse,
      })
    }
  }
  return defineDrain<TConfig>({
    name: options.name,
    resolve: options.resolve,
    send: buildSend(options.retries),
    // Raw callers (the pipeline) own retries: single attempt unless the
    // config sets retries explicitly.
    rawSend: buildSend(0),
  })
}
