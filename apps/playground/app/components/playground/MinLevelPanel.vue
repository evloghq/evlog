<script setup lang="ts">
import type { LogLevel } from 'evlog'
import { log, setMinLevel } from 'evlog/client'

const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']

const minLevel = ref<LogLevel>('debug')

const order: Record<LogLevel, number> = {
  trace: 0,
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
}

function passes(level: LogLevel): boolean {
  return order[level] >= order[minLevel.value]
}

function applyMinLevel(level: LogLevel) {
  minLevel.value = level
  setMinLevel(level)
}

function emitAt(level: LogLevel) {
  const payload = { panel: 'min-level', ts: Date.now() }
  if (level === 'trace') {
    log.trace(payload)
  } else if (level === 'debug') {
    log.debug(payload)
  } else if (level === 'info') {
    log.info(payload)
  } else if (level === 'warn') {
    log.warn('playground', 'warn sample')
  } else if (level === 'error') {
    log.error('playground', 'error sample')
  } else {
    log.fatal('playground', 'fatal sample')
  }
}

onMounted(() => {
  const raw = useRuntimeConfig().public.evlog as { minLevel?: LogLevel } | undefined
  const fromConfig = raw?.minLevel
  if (fromConfig && levels.includes(fromConfig)) {
    minLevel.value = fromConfig
    setMinLevel(fromConfig)
  }
})
</script>

<template>
  <ClientOnly>
    <div class="max-w-3xl space-y-6">
      <div
        class="rounded-lg border border-[var(--ui-border)] bg-elevated p-5 space-y-4"
      >
        <div>
          <p class="text-xs font-medium text-highlighted uppercase tracking-wide">
            Minimum level
          </p>
          <p class="text-xs text-muted mt-1 leading-relaxed">
            Only the global client <code class="text-[11px]">log.*</code> API is filtered. Open DevTools and watch the console: levels below the threshold produce no output and no transport when ingest is enabled.
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="lvl in levels"
            :key="lvl"
            size="sm"
            :variant="minLevel === lvl ? 'solid' : 'outline'"
            :color="minLevel === lvl ? 'primary' : 'neutral'"
            @click="applyMinLevel(lvl)"
          >
            {{ lvl }}
          </UButton>
        </div>

        <p class="text-[11px] text-muted leading-relaxed">
          <span class="text-highlighted">Passes:</span>
          {{ levels.filter(l => passes(l)).join(', ') }}
        </p>
        <p class="text-[11px] text-muted leading-relaxed">
          <code class="text-[11px]">log.debug()</code> uses <code class="text-[11px]">console.log</code> in the browser so lines show with the default console filter (payload still has <code class="text-[11px]">level: &quot;debug&quot;</code>).
        </p>
      </div>

      <div
        class="rounded-lg border border-[var(--ui-border)] bg-elevated p-5 space-y-4"
      >
        <p class="text-xs font-medium text-highlighted uppercase tracking-wide">
          Trigger logs
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="lvl in levels"
            :key="`emit-${lvl}`"
            size="sm"
            variant="soft"
            :color="lvl === 'error' || lvl === 'fatal' ? 'error' : lvl === 'warn' ? 'warning' : lvl === 'info' ? 'primary' : 'neutral'"
            @click="emitAt(lvl)"
          >
            log.{{ lvl }}()
          </UButton>
        </div>
        <p class="text-[11px] text-muted">
          Set minimum to <code class="text-[11px]">warn</code>, then trigger <code class="text-[11px]">log.info</code> — nothing should appear. Switch back to <code class="text-[11px]">debug</code> and trigger again to verify.
        </p>
      </div>
    </div>
    <template #fallback>
      <p class="text-sm text-muted">
        Loading…
      </p>
    </template>
  </ClientOnly>
</template>
