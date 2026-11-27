<script setup lang="ts">
import { Motion } from 'motion-v'

const prefersReducedMotion = ref(false)
const panelRef = ref<HTMLElement>()
const animStarted = ref(false)

const props = defineProps<{
  link?: string
  linkLabel?: string
}>()

const pills = [
  { label: 'Zero-alloc hot path', icon: 'i-lucide-zap' },
  { label: 'Reproducible benchmarks', icon: 'i-lucide-shield-check' },
  { label: 'Open source benchmarks', icon: 'i-lucide-code' },
]

interface Benchmark {
  lib: string
  ops: number
  color: string
}

const benchmarks: Benchmark[][] = [
  [
    { lib: 'evlog', ops: 1550000, color: 'primary' },
    { lib: 'consola', ops: 1010000, color: 'amber-500' },
    { lib: 'pino', ops: 465000, color: 'emerald-500' },
    { lib: 'winston', ops: 164000, color: 'muted' },
  ],
  [
    { lib: 'evlog', ops: 1700000, color: 'primary' },
    { lib: 'pino', ops: 845000, color: 'emerald-500' },
    { lib: 'winston', ops: 430000, color: 'muted' },
    { lib: 'consola', ops: 280000, color: 'amber-500' },
  ],
  [
    { lib: 'evlog', ops: 16850000, color: 'primary' },
    { lib: 'pino', ops: 7500000, color: 'emerald-500' },
    { lib: 'winston', ops: 5380000, color: 'muted' },
    { lib: 'consola', ops: 310000, color: 'amber-500' },
  ],
]

const benchLabels = ['Deep nested', 'Scoped logger', 'Logger creation']
const activeBench = ref(0)

function formatOps(ops: number): string {
  if (ops >= 1_000_000) return `${(ops / 1_000_000).toFixed(1)}M`
  return `${(ops / 1000).toFixed(0)}K`
}

function barWidth(bench: Benchmark[], entry: Benchmark): number {
  const max = bench[0]?.ops ?? 1
  return Math.max(4, (entry.ops / max) * 100)
}

function speedLabel(bench: Benchmark[], entry: Benchmark): string {
  const evlogOps = bench[0]?.ops ?? 1
  const ratio = evlogOps / entry.ops
  return `${ratio.toFixed(1)}x slower`
}

let observer: IntersectionObserver | undefined

onMounted(() => {
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const el = panelRef.value
  if (el) {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          animStarted.value = true
          observer?.disconnect()
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(el)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
})
</script>

<template>
  <section class="py-24 md:py-32" data-section="features-feature-performance">
    <Motion
      :initial="false"
      :while-in-view="{ opacity: 1, y: 0 }"
      :transition="{ duration: 0.5 }"
      :in-view-options="{ once: true }"
      class="mb-8"
    >
      <div>
        <p v-if="$slots.headline" class="section-label">
          <slot name="headline" mdc-unwrap="p" />
        </p>
        <div class="relative mb-5">
          <h2 class="section-title max-w-2xl">
            <slot name="title" mdc-unwrap="p" /><span class="text-primary">.</span>
          </h2>
          <div aria-hidden="true" class="title-glow section-title max-w-2xl">
            <slot name="title" mdc-unwrap="p" /><span class="text-primary">.</span>
          </div>
        </div>
        <p v-if="$slots.description" class="max-w-lg text-sm leading-relaxed text-muted">
          <slot name="description" mdc-unwrap="p" />
        </p>
        <div class="mt-5 flex flex-wrap gap-2">
          <span
            v-for="pill in pills"
            :key="pill.label"
            class="inline-flex items-center gap-1.5 border border-muted bg-elevated/50 px-3 py-1 font-mono text-[11px] text-muted"
          >
            <UIcon :name="pill.icon" class="size-3 text-primary" />
            {{ pill.label }}
          </span>
        </div>
        <NuxtLink v-if="props.link" :to="props.link" class="mt-4 inline-flex items-center gap-1.5 font-mono text-xs text-dimmed hover:text-primary transition-colors">
          {{ props.linkLabel || 'Learn more' }}
          <UIcon name="i-lucide-arrow-right" class="size-3" />
        </NuxtLink>
      </div>
    </Motion>

    <div class="grid gap-6 lg:grid-cols-2 *:min-w-0">
      <Motion
        :initial="false"
        :while-in-view="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5, delay: 0.1 }"
        :in-view-options="{ once: true }"
      >
        <div ref="panelRef" class="h-full overflow-hidden border border-muted bg-default flex flex-col">
          <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
            <div class="flex gap-1.5">
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
            </div>
            <span class="ml-3 font-mono text-xs text-dimmed">benchmark</span>
            <div class="ml-auto flex items-center gap-1">
              <button
                v-for="(label, idx) in benchLabels"
                :key="label"
                type="button"
                class="font-mono text-[10px] px-2 py-0.5 border transition-all duration-300 outline-none cursor-pointer"
                :class="activeBench === idx
                  ? 'border-primary/30 bg-primary/10 text-highlighted'
                  : 'border-transparent text-muted hover:text-highlighted'"
                :aria-label="`${label} benchmark`"
                :aria-pressed="activeBench === idx"
                @click="activeBench = idx"
              >
                {{ label }}
              </button>
            </div>
          </div>

          <div class="grid *:col-start-1 *:row-start-1 flex-1">
            <div
              v-for="(bench, bIdx) in benchmarks"
              :key="bIdx"
              class="p-5 sm:p-6 transition-opacity duration-300"
              :class="activeBench === bIdx ? 'opacity-100' : 'opacity-0 pointer-events-none'"
            >
              <div
                v-for="(entry, eIdx) in bench"
                :key="entry.lib"
                class="flex items-center gap-3 py-2.5"
              >
                <span
                  class="w-14 shrink-0 font-mono text-xs text-right"
                  :class="entry.lib === 'evlog' ? 'text-white font-medium' : 'text-dimmed'"
                >
                  {{ entry.lib }}
                </span>

                <div class="flex-1 h-7 relative">
                  <div
                    class="absolute inset-y-0 left-0 flex items-center transition-all ease-out"
                    :class="entry.lib === 'evlog' ? 'perf-bar-glow' : ''"
                    :style="{
                      width: animStarted ? `${barWidth(bench, entry)}%` : '0%',
                      transitionDuration: prefersReducedMotion ? '0ms' : `${600 + eIdx * 150}ms`,
                      transitionDelay: prefersReducedMotion ? '0ms' : `${eIdx * 80}ms`,
                    }"
                  >
                    <div
                      class="size-full"
                      :class="{
                        'bg-primary': entry.color === 'primary',
                        'bg-amber-500/60': entry.color === 'amber-500',
                        'bg-emerald-500/60': entry.color === 'emerald-500',
                        'bg-muted/60': entry.color === 'muted',
                      }"
                    />
                  </div>
                </div>

                <span
                  class="shrink-0 font-mono text-xs tabular-nums text-right transition-opacity duration-500 flex items-baseline justify-end gap-1.5"
                  :class="[
                    animStarted ? 'opacity-100' : 'opacity-0',
                    entry.lib === 'evlog' ? 'w-12' : 'w-28',
                  ]"
                  :style="{ transitionDelay: prefersReducedMotion ? '0ms' : `${400 + eIdx * 150}ms` }"
                >
                  <span :class="entry.lib === 'evlog' ? 'text-primary font-medium' : 'text-dimmed'">
                    {{ formatOps(entry.ops) }}
                  </span>
                  <span
                    v-if="entry.lib !== 'evlog'"
                    class="text-[10px] text-dimmed"
                  >
                    {{ speedLabel(bench, entry) }}
                  </span>
                </span>
              </div>

              <div class="mt-3 pt-3 border-t border-muted/50">
                <p class="font-mono text-[10px] text-dimmed">
                  ops/sec · higher is better · silent mode (no I/O)
                </p>
              </div>
            </div>
          </div>

          <div class="border-t border-muted/50 px-5 sm:px-6 py-4">
            <div class="flex items-center font-mono text-[11px]">
              <span class="text-white font-medium tabular-nums">0</span>
              <span class="text-dimmed ml-1">deps</span>
              <span class="text-muted mx-3">/</span>
              <span class="text-white font-medium tabular-nums">~6 kB</span>
              <span class="text-dimmed ml-1">gzip</span>
              <span class="text-muted mx-3">/</span>
              <span class="text-white font-medium tabular-nums">12</span>
              <span class="text-dimmed ml-1">frameworks</span>
              <span class="text-muted mx-3">/</span>
              <span class="text-dimmed">tree-shakeable</span>
            </div>
          </div>
        </div>
      </Motion>

      <Motion
        :initial="false"
        :while-in-view="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5, delay: 0.2 }"
        :in-view-options="{ once: true }"
      >
        <div class="h-full overflow-hidden border border-muted bg-default flex flex-col">
          <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
            <div class="flex gap-1.5">
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
            </div>
            <span class="ml-3 font-mono text-xs text-dimmed">why it's fast</span>
          </div>

          <div class="p-5 sm:p-6 space-y-5 flex-1">
            <div class="flex items-start gap-3">
              <div class="mt-0.5 flex size-6 shrink-0 items-center justify-center border border-primary/20 bg-primary/5">
                <UIcon name="i-lucide-merge" class="size-3.5 text-primary" />
              </div>
              <div>
                <p class="font-mono text-xs text-highlighted">
                  1 event, not N log lines
                </p>
                <p class="mt-0.5 text-[11px] leading-relaxed text-dimmed">
                  Accumulate context, emit once. 75% less data downstream.
                </p>
              </div>
            </div>

            <div class="flex items-start gap-3">
              <div class="mt-0.5 flex size-6 shrink-0 items-center justify-center border border-primary/20 bg-primary/5">
                <UIcon name="i-lucide-pen-tool" class="size-3.5 text-primary" />
              </div>
              <div>
                <p class="font-mono text-xs text-highlighted">
                  In-place mutations
                </p>
                <p class="mt-0.5 text-[11px] leading-relaxed text-dimmed">
                  No object spreads, no copies. Direct recursive merge.
                </p>
              </div>
            </div>

            <div class="flex items-start gap-3">
              <div class="mt-0.5 flex size-6 shrink-0 items-center justify-center border border-primary/20 bg-primary/5">
                <UIcon name="i-lucide-clock" class="size-3.5 text-primary" />
              </div>
              <div>
                <p class="font-mono text-xs text-highlighted">
                  Lazy allocation
                </p>
                <p class="mt-0.5 text-[11px] leading-relaxed text-dimmed">
                  Timestamps, sampling context — created only when needed.
                </p>
              </div>
            </div>

            <div class="flex items-start gap-3">
              <div class="mt-0.5 flex size-6 shrink-0 items-center justify-center border border-primary/20 bg-primary/5">
                <UIcon name="i-lucide-file-code" class="size-3.5 text-primary" />
              </div>
              <div>
                <p class="font-mono text-xs text-highlighted">
                  No serialization until drain
                </p>
                <p class="mt-0.5 text-[11px] leading-relaxed text-dimmed">
                  Plain objects throughout. JSON.stringify runs once at the end.
                </p>
              </div>
            </div>

            <div class="flex items-start gap-3">
              <div class="mt-0.5 flex size-6 shrink-0 items-center justify-center border border-primary/20 bg-primary/5">
                <UIcon name="i-lucide-box" class="size-3.5 text-primary" />
              </div>
              <div>
                <p class="font-mono text-xs text-highlighted">
                  Zero dependencies
                </p>
                <p class="mt-0.5 text-[11px] leading-relaxed text-dimmed">
                  No transitive deps. Nothing to audit, nothing to break.
                </p>
              </div>
            </div>
          </div>

          <div class="border-t border-muted/50 px-5 sm:px-6 py-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="font-mono text-xs text-highlighted">
                  Total overhead per request
                </p>
                <p class="font-mono text-[10px] text-dimmed mt-0.5">
                  create + 3x set + emit + sampling + enrichers
                </p>
              </div>
              <div class="text-right">
                <p class="font-mono text-xl font-medium text-highlighted tabular-nums">
                  ~3µs
                </p>
                <p class="font-mono text-[10px] text-dimmed">
                  0.003ms
                </p>
              </div>
            </div>
          </div>
        </div>
      </Motion>
    </div>
  </section>
</template>

<style scoped>
.perf-bar-glow {
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--color-blue-500) 30%, transparent));
}
</style>
