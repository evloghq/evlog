import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isCI } from 'std-env'
import { readPreferenceSync, resolveConsent, writePreference, purgeOutbox } from './consent'
import {
  composeDrains,
  createDebugDrain,
  createHttpDrain,
  createNoopDrain,
  resolveEndpoint,
  type TelemetryDrain,
} from './drain'
import { buildEnvInfo, resolveMachineId } from './enrich'
import {
  MAX_FLUSH_BATCH,
  resolveFlushIntervalMs,
  resolveFlushThreshold,
  shouldFlushOutbox,
} from './flush-policy'
import { computeRunIdempotencyKey } from './idempotency'
import { TelemetryOutbox } from './outbox'
import { sanitizeCustom, sanitizeFlags, sanitizeSystemCustom } from './sanitize'
import { getRunContext, runWithContext } from './storage'
import type {
  CollectFields,
  CollectFlags,
  CustomFields,
  FlagDefinitions,
  RunEvent,
  RunOutcome,
  TelemetryCliError,
  TelemetryHandle,
  TelemetryOptions,
} from './types'
import { getTelemetryDir } from './paths'
import { formatTelemetryNotice, isInteractiveTerminal, wasNoticeShown } from './notice'

let activeHandle: InternalTelemetry<any, any> | null = null

function isCliError(err: unknown): err is TelemetryCliError {
  return typeof err === 'object' && err !== null && typeof (err as TelemetryCliError).code === 'string'
}

class InternalTelemetry<
  TFlags extends CollectFlags = {},
  TFields extends CollectFields = {},
> implements TelemetryHandle<TFlags, TFields> {
  private _enabled: boolean
  readonly options: TelemetryOptions<TFlags, TFields>
  private readonly outbox: TelemetryOutbox
  private readonly drain: TelemetryDrain
  private machineId?: string
  private noticeShown = false

  constructor(options: TelemetryOptions<TFlags, TFields>, enabled: boolean) {
    this.options = options
    this._enabled = enabled
    this.outbox = new TelemetryOutbox({
      toolName: options.name,
      maxBufferBytes: options.maxBufferBytes,
      maxEventAgeMs: options.maxEventAgeMs,
    })

    const endpoint = resolveEndpoint(options.endpoint)
    const drains = [createDebugDrain()]
    if (endpoint) drains.push(createHttpDrain(endpoint))
    else drains.push(createNoopDrain())
    this.drain = composeDrains(...drains)
  }

  get enabled(): boolean {
    return this._enabled
  }

  set(fields: CustomFields<TFields>): void {
    const ctx = getRunContext()
    if (!ctx) return
    ctx.custom = sanitizeCustom(
      fields as Record<string, unknown>,
      ctx.custom,
      ctx.collect,
    )
  }

  /** @internal Update runtime consent for the active instance. */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled
  }

  async init(): Promise<void> {
    if (!this._enabled) return
    this.machineId = await resolveMachineId(this.options.name)
  }

  async run<T>(
    command: string,
    fn: () => T | Promise<T>,
    opts?: {
      flags?: Record<string, unknown>
      args?: FlagDefinitions
      systemCustom?: Record<string, string>
    },
  ): Promise<T> {
    if (!this._enabled) return fn()

    await this.maybeShowNotice()
    const started = Date.now()
    const timestamp = new Date().toISOString()
    const ctx = {
      custom: sanitizeSystemCustom(opts?.systemCustom) as Record<string, boolean | number | string>,
      collect: this.options.collect,
    }
    let outcome: RunOutcome = 'success'
    let errorCode: string | undefined

    try {
      return await runWithContext(ctx, async () => await fn())
    } catch (err) {
      outcome = 'error'
      if (isCliError(err)) errorCode = err.code
      throw err
    } finally {
      const event = this.buildEvent({
        command,
        durationMs: Date.now() - started,
        outcome,
        errorCode,
        flags: sanitizeFlags(opts?.flags, { collect: this.options.collect, args: opts?.args }),
        custom: ctx.custom,
        timestamp,
      })
      await this.record(event)
      if (await this.shouldFlush()) await this.deliver(false)
    }
  }

  async flush(): Promise<void> {
    await this.deliver(true)
  }

  /** `drainAll` sends batch after batch until the outbox is empty; a `run()` sends one batch per command. */
  private async deliver(drainAll: boolean): Promise<void> {
    if (!this._enabled) return
    const timeoutMs = this.options.flushTimeoutMs ?? 500
    try {
      await Promise.race([
        this.flushBacklog(drainAll),
        new Promise<void>(resolve => {
          const t = setTimeout(resolve, timeoutMs)
          ;(t as { unref?: () => void }).unref?.()
        }),
      ])
    } catch {
      // never throw
    }
  }

  private async shouldFlush(): Promise<boolean> {
    const { count, oldestStoredAt } = await this.outbox.inspect()
    const lastFlushAt = await this.outbox.readLastFlushAt()
    return shouldFlushOutbox({
      pending: count,
      lastFlushAt,
      oldestStoredAt,
      now: Date.now(),
      intervalMs: resolveFlushIntervalMs(this.options.flushIntervalMs, isCI),
      threshold: resolveFlushThreshold(this.options.flushThreshold),
    })
  }

  private async flushBacklog(drainAll: boolean): Promise<void> {
    const pending = await this.outbox.readAll()
    for (let start = 0; start < pending.length; start += MAX_FLUSH_BATCH) {
      const batch = pending.slice(start, start + MAX_FLUSH_BATCH)
      if (!await this.drain(batch)) return
      await this.outbox.removeDelivered(new Set(batch.map(e => e.idempotencyKey)))
      await this.outbox.markFlushed()
      if (!drainAll) return
    }
  }

  private buildEvent(parts: {
    command: string
    durationMs: number
    outcome: RunOutcome
    errorCode?: string
    flags: Record<string, boolean | number | string>
    custom: Record<string, boolean | number | string>
    timestamp: string
  }): RunEvent {
    const tool = { name: this.options.name, version: this.options.version }
    const idempotencyKey = computeRunIdempotencyKey({
      command: parts.command,
      tool,
      timestamp: parts.timestamp,
      machineId: this.machineId,
    })
    return {
      event: 'run',
      command: parts.command,
      durationMs: parts.durationMs,
      outcome: parts.outcome,
      errorCode: parts.errorCode,
      flags: parts.flags,
      tool,
      env: buildEnvInfo({ environment: this.options.environment }),
      machineId: this.machineId,
      custom: parts.custom,
      idempotencyKey,
      timestamp: parts.timestamp,
    }
  }

  private async record(event: RunEvent): Promise<void> {
    await this.outbox.append(event)
  }

  private async maybeShowNotice(): Promise<void> {
    if (this.noticeShown) return
    if (!isInteractiveTerminal()) return
    if (readPreferenceSync(this.options.name) !== 'unset') return
    if (wasNoticeShown(this.options.name)) return
    this.noticeShown = true
    const dir = getTelemetryDir(this.options.name)
    process.stderr.write(formatTelemetryNotice(this.options.name))
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'notice-shown'), '', 'utf-8')
    } catch {
      // silent
    }
  }
}

/**
 * Create a telemetry instance for non-citty tools.
 * Use {@link withTelemetry} when integrating with citty.
 */
export function createTelemetry<
  TFlags extends CollectFlags = {},
  TFields extends CollectFields = {},
>(options: TelemetryOptions<TFlags, TFields>): TelemetryHandle<TFlags, TFields> {
  const enabled = resolveConsent(options.name)
  const instance = new InternalTelemetry<TFlags, TFields>(options, enabled)
  activeHandle = instance
  void instance.init()
  return instance
}

/**
 * Ambient custom-field setter — works anywhere inside an active `run()` scope.
 * Accepts numbers and booleans by default; strings require `collect.fields`.
 * Prefer {@link TelemetryHandle.set} on the handle returned by {@link createTelemetry}
 * for allowlisted string autocomplete.
 */
export const telemetry = {
  set(fields: CustomFields): void {
    const ctx = getRunContext()
    if (!ctx) return
    ctx.custom = sanitizeCustom(
      fields as Record<string, unknown>,
      ctx.custom,
      ctx.collect,
    )
  },
}

/** Disable telemetry and purge the local outbox. */
export async function disableTelemetry(toolName: string): Promise<void> {
  if (activeHandle?.options.name === toolName) {
    activeHandle.setEnabled(false)
  }
  await writePreference(toolName, 'disabled')
  await purgeOutbox(toolName)
}

/** Enable telemetry (persisted preference). */
export async function enableTelemetry(toolName: string): Promise<void> {
  await writePreference(toolName, 'enabled')
  if (activeHandle?.options.name === toolName) {
    activeHandle.setEnabled(true)
    void activeHandle.init()
  }
}

/** @internal Test hook */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function _resetActiveTelemetryForTests(): void {
  activeHandle = null
}

/** @internal Test hook */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function _getActiveTelemetryForTests(): InternalTelemetry<any, any> | null {
  return activeHandle
}
