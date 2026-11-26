import type { DrainContext, WideEvent } from 'evlog'

/** Where every scenario config drains to, so the harness can read back the event evlog built. */
export const drained: WideEvent[] = []

export function capture(ctx: DrainContext) {
  drained.push(ctx.event)
}
