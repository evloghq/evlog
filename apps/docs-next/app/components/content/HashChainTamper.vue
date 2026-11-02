<script setup lang="ts">
import type { TimedEvent } from '~/composables/useTimedSequence'

interface AuditRow {
  id: string
  action: string
  actor: string
  outcomeOriginal: 'success' | 'denied' | 'failure'
  outcomeTampered: 'success' | 'denied' | 'failure'
  prevHash: string | null
  hash: string
}

const rows: AuditRow[] = [
  {
    id: '1',
    action: 'invoice.refund',
    actor: 'usr_42',
    outcomeOriginal: 'success',
    outcomeTampered: 'success',
    prevHash: null,
    hash: '3f2c8e1a',
  },
  {
    id: '2',
    action: 'user.update',
    actor: 'usr_42',
    outcomeOriginal: 'denied',
    outcomeTampered: 'success',
    prevHash: '3f2c8e1a',
    hash: '9a1b4d7c',
  },
  {
    id: '3',
    action: 'apiKey.revoke',
    actor: 'usr_42',
    outcomeOriginal: 'success',
    outcomeTampered: 'success',
    prevHash: '9a1b4d7c',
    hash: 'c4e7f2b9',
  },
]

type LinkState = 'pending' | 'ok' | 'broken' | 'invalid'
type ChainStatus = 'idle' | 'verifying' | 'ok' | 'tampered'

const TAMPERED_INDEX = 1

const revealed = ref<boolean[]>(rows.map(() => false))
const linkState = ref<LinkState[]>(rows.map(() => 'pending'))
const tampered = ref(false)
const status = ref<ChainStatus>('idle')
const prefersReducedMotion = ref(false)
const wrapperRef = ref<HTMLElement>()

function resetState() {
  revealed.value = rows.map(() => false)
  linkState.value = rows.map(() => 'pending')
  tampered.value = false
  status.value = 'idle'
}

const REVEAL_AT = 200
const REVEAL_INTERVAL = 600
const VERIFY_START = REVEAL_AT + rows.length * REVEAL_INTERVAL + 400
const VERIFY_INTERVAL = 600
const VERIFY_END = VERIFY_START + rows.length * VERIFY_INTERVAL
const HOLD_OK = VERIFY_END + 1500
const TAMPER_AT = HOLD_OK + 200
const REVERIFY_START = TAMPER_AT + 1300
const REVERIFY_INTERVAL = 700
const REVERIFY_END = REVERIFY_START + rows.length * REVERIFY_INTERVAL
const TAIL_HOLD = 4000

function buildEvents(): TimedEvent[] {
  const events: TimedEvent[] = []

  rows.forEach((_, i) => {
    events.push({
      at: REVEAL_AT + i * REVEAL_INTERVAL,
      run: () => {
        revealed.value = revealed.value.map((v, idx) => idx === i ? true : v)
      },
    })
  })

  events.push({
    at: VERIFY_START - 100,
    run: () => {
      status.value = 'verifying'
    },
  })

  rows.forEach((_, i) => {
    events.push({
      at: VERIFY_START + i * VERIFY_INTERVAL,
      run: () => {
        linkState.value = linkState.value.map((v, idx) => idx === i ? 'ok' : v)
      },
    })
  })

  events.push({
    at: VERIFY_END,
    run: () => {
      status.value = 'ok'
    },
  })

  events.push({
    at: TAMPER_AT,
    run: () => {
      tampered.value = true
      status.value = 'idle'
    },
  })

  events.push({
    at: REVERIFY_START - 100,
    run: () => {
      status.value = 'verifying'
      linkState.value = rows.map(() => 'pending')
    },
  })

  rows.forEach((_, i) => {
    events.push({
      at: REVERIFY_START + i * REVERIFY_INTERVAL,
      run: () => {
        let next: LinkState
        if (i < TAMPERED_INDEX) next = 'ok'
        else if (i === TAMPERED_INDEX) next = 'broken'
        else next = 'invalid'

        linkState.value = linkState.value.map((v, idx) => idx === i ? next : v)
      },
    })
  })

  events.push({
    at: REVERIFY_END,
    run: () => {
      status.value = 'tampered'
    },
  })

  return events
}

const events = buildEvents()
const totalDuration = REVERIFY_END + TAIL_HOLD

const { start, toggle, restart, paused, started } = useTimedSequence({
  events,
  totalDuration,
  loop: true,
  onReset: resetState,
})

let observer: IntersectionObserver | undefined

onMounted(() => {
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReducedMotion.value) {
    revealed.value = rows.map(() => true)
    tampered.value = true
    linkState.value = rows.map((_, i) => {
      if (i < TAMPERED_INDEX) return 'ok'
      if (i === TAMPERED_INDEX) return 'broken'
      return 'invalid'
    })
    status.value = 'tampered'
    return
  }
  if (!wrapperRef.value) {
    start()
    return
  }
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) {
        start()
        observer?.disconnect()
      }
    },
    { threshold: 0.25 },
  )
  observer.observe(wrapperRef.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
})

function rowOutcome(row: AuditRow) {
  return tampered.value ? row.outcomeTampered : row.outcomeOriginal
}

function rowChanged(idx: number) {
  const row = rows[idx]
  if (!row) return false
  return tampered.value && row.outcomeOriginal !== row.outcomeTampered
}

const statusLabel = computed(() => {
  switch (status.value) {
    case 'verifying': return 'verifying chain…'
    case 'ok': return 'chain verified'
    case 'tampered': return 'tampering detected'
    default: return 'idle'
  }
})

const statusClass = computed(() => {
  switch (status.value) {
    case 'verifying': return 'text-amber-400'
    case 'ok': return 'text-emerald-400'
    case 'tampered': return 'text-rose-400'
    default: return 'text-dimmed'
  }
})

function outcomeClass(outcome: 'success' | 'denied' | 'failure') {
  if (outcome === 'success') return 'text-emerald-400'
  if (outcome === 'denied') return 'text-amber-400'
  return 'text-rose-400'
}
</script>

<template>
  <div class="not-prose my-8" data-section="hash-chain-tamper">
    <div ref="wrapperRef" class="overflow-hidden border border-muted bg-default">
      <div class="flex items-center gap-2 border-b border-muted px-4 py-2.5">
        <UIcon name="i-lucide-link-2" class="size-3.5 text-primary" />
        <span class="font-mono text-xs text-dimmed">audit chain</span>
        <span class="text-dimmed">·</span>
        <span class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-300" :class="statusClass">
          {{ statusLabel }}
        </span>
        <div class="ml-auto hidden sm:flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-dimmed">
          <UIcon name="i-lucide-shield-check" class="size-3" />
          <span>signed · hash-chain</span>
        </div>
        <div class="flex items-center gap-0.5 ml-1.5 sm:ml-2">
          <button
            type="button"
            class="size-6 inline-flex items-center justify-center text-dimmed hover:text-default focus:text-default focus:outline-none transition-colors"
            :aria-label="paused ? 'Play animation' : 'Pause animation'"
            :disabled="!started"
            @click="toggle"
          >
            <UIcon :name="paused ? 'i-lucide-play' : 'i-lucide-pause'" class="size-3" />
          </button>
          <button
            type="button"
            class="size-6 inline-flex items-center justify-center text-dimmed hover:text-default focus:text-default focus:outline-none transition-colors"
            aria-label="Restart animation"
            :disabled="!started"
            @click="restart"
          >
            <UIcon name="i-lucide-rotate-ccw" class="size-3" />
          </button>
        </div>
      </div>

      <ol class="relative px-4 sm:px-6 py-5 sm:py-6 space-y-3.5">
        <li
          v-for="(row, i) in rows"
          :key="row.id"
          class="relative flex items-stretch gap-3 sm:gap-4"
        >
          <div class="relative shrink-0 w-2.5 flex justify-center pt-3">
            <span
              v-if="i < rows.length - 1"
              aria-hidden="true"
              class="pointer-events-none absolute top-[22px] bottom-[-26px] left-1/2 -translate-x-1/2 w-px transition-colors duration-500"
              :class="{
                'bg-rose-500/70': linkState[i + 1] === 'broken' || linkState[i + 1] === 'invalid',
                'bg-emerald-500/70': linkState[i + 1] === 'ok',
                'bg-muted/60': linkState[i + 1] === 'pending',
              }"
            />
            <span
              class="relative z-10 size-2.5 rounded-full transition-colors duration-500"
              :class="{
                'bg-rose-500 shadow-[0_0_8px_rgb(244,63,94)]': linkState[i] === 'broken',
                'bg-rose-500/50': linkState[i] === 'invalid',
                'bg-emerald-500 shadow-[0_0_8px_rgb(52,211,153)]': linkState[i] === 'ok',
                'bg-accented': linkState[i] === 'pending',
              }"
            />
          </div>

          <div
            class="relative flex-1 min-w-0 border bg-elevated/30 transition-all duration-500 overflow-hidden"
            :class="{
              'opacity-100 translate-y-0': revealed[i],
              'opacity-0 translate-y-2': !revealed[i],
              'border-rose-500/50 bg-rose-500/4': linkState[i] === 'broken',
              'border-rose-500/30 bg-rose-500/2': linkState[i] === 'invalid',
              'border-emerald-500/40': linkState[i] === 'ok',
              'border-muted': linkState[i] === 'pending' || !revealed[i],
            }"
          >
            <div class="flex items-center gap-2 sm:gap-3 px-3 py-2.5">
              <div class="min-w-0 flex-1 flex items-center gap-2 sm:gap-3 font-mono text-[11px] sm:text-xs">
                <span class="text-dimmed shrink-0">#{{ row.id }}</span>
                <span class="text-sky-400 truncate">{{ row.action }}</span>
                <span class="hidden sm:inline text-dimmed">·</span>
                <span class="hidden sm:inline text-muted truncate">{{ row.actor }}</span>
                <span class="text-dimmed shrink-0">·</span>
                <span
                  class="font-mono text-[10px] tracking-widest uppercase transition-colors duration-500 shrink-0"
                  :class="[outcomeClass(rowOutcome(row)), rowChanged(i) ? 'animate-pulse' : '']"
                >
                  {{ rowOutcome(row) }}
                </span>
              </div>

              <div class="font-mono text-[9px] tracking-widest uppercase shrink-0">
                <span
                  v-if="linkState[i] === 'broken'"
                  class="inline-flex items-center gap-1 text-rose-400"
                >
                  <UIcon name="i-lucide-unlink" class="size-3" />
                  <span class="hidden sm:inline">hash mismatch</span>
                </span>
                <span
                  v-else-if="linkState[i] === 'invalid'"
                  class="inline-flex items-center gap-1 text-rose-400/80"
                >
                  <UIcon name="i-lucide-x" class="size-3" />
                  <span class="hidden sm:inline">invalid</span>
                </span>
                <span
                  v-else-if="linkState[i] === 'ok'"
                  class="inline-flex items-center gap-1 text-emerald-400"
                >
                  <UIcon name="i-lucide-check" class="size-3" />
                  <span class="hidden sm:inline">link ok</span>
                </span>
                <span
                  v-else
                  class="inline-flex items-center gap-1 text-dimmed/70"
                >
                  <UIcon name="i-lucide-loader" class="size-3 animate-spin" />
                  <span class="hidden sm:inline">pending</span>
                </span>
              </div>
            </div>

            <div
              class="flex items-center gap-1.5 sm:gap-2 px-3 pb-2.5 font-mono text-[10px] text-muted truncate"
            >
              <span class="text-dimmed">prev:</span>
              <span class="text-dimmed/80 truncate">{{ row.prevHash ?? '∅' }}</span>
              <UIcon name="i-lucide-arrow-right" class="size-2.5 text-dimmed/60 shrink-0" />
              <span class="text-dimmed">hash:</span>
              <span
                class="truncate transition-colors duration-300"
                :class="linkState[i] === 'broken' || linkState[i] === 'invalid' ? 'text-rose-400/80' : 'text-emerald-400/70'"
              >
                {{ row.hash }}
              </span>
            </div>
          </div>
        </li>
      </ol>

      <div
        class="border-t border-muted/50 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px]"
      >
        <span class="inline-flex items-center gap-1.5 text-dimmed">
          <span class="size-1.5 rounded-full bg-emerald-500" />
          link ok
        </span>
        <span class="inline-flex items-center gap-1.5 text-dimmed">
          <span class="size-1.5 rounded-full bg-rose-500" />
          tamper detected
        </span>
        <span
          class="ml-auto transition-opacity duration-500"
          :class="status === 'tampered' ? 'opacity-100 text-rose-400' : status === 'ok' ? 'opacity-100 text-emerald-400' : 'opacity-0'"
        >
          <template v-if="status === 'tampered'">
            row #{{ TAMPERED_INDEX + 1 }} mutated · {{ rows.length - TAMPERED_INDEX }} downstream events invalidated
          </template>
          <template v-else>
            chain verified · {{ rows.length }} events intact
          </template>
        </span>
      </div>
    </div>
  </div>
</template>
