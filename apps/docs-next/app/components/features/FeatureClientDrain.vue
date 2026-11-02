<script setup lang="ts">
import { Motion } from 'motion-v'

const props = defineProps<{
  link?: string
  linkLabel?: string
}>()

const pills = [
  { label: 'Auto-batch', icon: 'i-lucide-layers' },
  { label: 'sendBeacon', icon: 'i-lucide-send' },
  { label: 'Origin validation', icon: 'i-lucide-shield-check' },
]
</script>

<template>
  <section class="py-24 md:py-32" data-section="features-feature-client-drain">
    <div class="grid gap-6 lg:grid-cols-2 *:min-w-0">
      <div class="flex flex-col gap-8">
        <Motion
          :initial="false"
          :while-in-view="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.5 }"
          :in-view-options="{ once: true }"
        >
          <div>
            <p v-if="$slots.headline" class="section-label">
              <slot name="headline" mdc-unwrap="p" />
            </p>
            <div class="relative mb-4">
              <h2 class="section-title">
                <slot name="title" mdc-unwrap="p" /><span class="text-primary">.</span>
              </h2>
              <div aria-hidden="true" class="title-glow section-title">
                <slot name="title" mdc-unwrap="p" /><span class="text-primary">.</span>
              </div>
            </div>
            <p v-if="$slots.description" class="max-w-md text-sm leading-relaxed text-muted">
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

        <Motion
          :initial="false"
          :while-in-view="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.5, delay: 0.15 }"
          :in-view-options="{ once: true }"
        >
          <div class="space-y-5">
            <div class="flex items-start gap-3">
              <UIcon name="i-lucide-layers" class="size-4 mt-0.5 shrink-0 text-primary" />
              <div>
                <p class="font-mono text-xs text-highlighted">
                  Automatic batching
                </p>
                <p class="mt-1 text-xs leading-relaxed text-dimmed">
                  Events are batched by size and time interval, reducing network overhead.
                </p>
              </div>
            </div>
            <div class="flex items-start gap-3">
              <UIcon name="i-lucide-send" class="size-4 mt-0.5 shrink-0 text-primary" />
              <div>
                <p class="font-mono text-xs text-highlighted">
                  Page-aware delivery
                </p>
                <p class="mt-1 text-xs leading-relaxed text-dimmed">
                  Switches to sendBeacon when the page is hidden. No event left behind.
                </p>
              </div>
            </div>
            <div class="flex items-start gap-3">
              <UIcon name="i-lucide-shield-check" class="size-4 mt-0.5 shrink-0 text-primary" />
              <div>
                <p class="font-mono text-xs text-highlighted">
                  Server-side validation
                </p>
                <p class="mt-1 text-xs leading-relaxed text-dimmed">
                  Origin check, payload sanitization, and source tagging on every ingest.
                </p>
              </div>
            </div>
          </div>
        </Motion>
      </div>

      <Motion
        :initial="false"
        :while-in-view="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5, delay: 0.1 }"
        :in-view-options="{ once: true }"
      >
        <div class="overflow-hidden border border-muted bg-default">
          <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
            <div class="flex gap-1.5">
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
            </div>
            <span class="ml-3 font-mono text-xs text-dimmed">http-drain.ts</span>
          </div>

          <div class="px-5 pt-5 pb-4 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto">
            <pre><code><span class="text-violet-400">import</span> { createHttpLogDrain } <span class="text-violet-400">from</span> <span class="text-emerald-400">'evlog/http'</span>

<span class="text-violet-400">const</span> drain = <span class="text-amber-400">createHttpLogDrain</span>({
  <span class="text-sky-400">drain</span>: {
    <span class="text-sky-400">endpoint</span>: <span class="text-emerald-400">'/api/_evlog/ingest'</span>,
  },
  <span class="text-sky-400">pipeline</span>: {
    <span class="text-sky-400">batch</span>: { <span class="text-sky-400">size</span>: <span class="text-pink-400">25</span>, <span class="text-sky-400">intervalMs</span>: <span class="text-pink-400">2000</span> },
    <span class="text-sky-400">retry</span>: { <span class="text-sky-400">maxAttempts</span>: <span class="text-pink-400">2</span> },
  },
})

<span class="text-amber-400">initLogger</span>({ drain })</code></pre>
          </div>

          <div class="border-t border-muted/50 px-4 sm:px-6 py-8 sm:py-10">
            <div class="flex items-start justify-between">
              <div class="flex flex-col items-center gap-2 shrink-0">
                <div class="border border-muted bg-default p-3">
                  <UIcon name="i-lucide-globe" class="size-5 text-primary" />
                </div>
                <span class="font-mono text-[9px] text-muted">Browser</span>
                <span class="font-mono text-[7px] tracking-widest text-dimmed">EVENTS</span>
              </div>

              <div class="connection flex-1 self-[22px] mt-5 mx-2 sm:mx-3">
                <div class="h-px bg-muted relative overflow-hidden">
                  <div class="pulse-trail" />
                </div>
                <p class="mt-2 text-center font-mono text-[7px] tracking-wider text-dimmed">
                  BATCH &middot; FLUSH
                </p>
              </div>

              <div class="flex flex-col items-center gap-2 shrink-0">
                <div class="relative border border-primary/30 bg-default p-3">
                  <div class="flex items-center gap-1.5">
                    <span class="relative flex size-1.5">
                      <span class="absolute inline-flex size-full animate-ping bg-primary/40" />
                      <span class="relative inline-flex size-1.5 bg-primary" />
                    </span>
                    <UIcon name="i-lucide-layers" class="size-5 text-primary" />
                  </div>
                </div>
                <span class="font-mono text-[9px] text-muted">Pipeline</span>
                <span class="font-mono text-[7px] tracking-widest text-dimmed">RETRY &middot; BACKOFF</span>
              </div>

              <div class="connection flex-1 self-[22px] mt-5 mx-2 sm:mx-3">
                <div class="h-px bg-muted relative overflow-hidden">
                  <div class="pulse-trail pulse-trail-delayed" />
                </div>
                <p class="mt-2 text-center font-mono text-[7px] tracking-wider text-dimmed">
                  POST &middot; BEACON
                </p>
              </div>

              <div class="flex flex-col items-center gap-2 shrink-0">
                <div class="border border-muted bg-default p-3">
                  <UIcon name="i-lucide-server" class="size-5 text-dimmed" />
                </div>
                <span class="font-mono text-[9px] text-muted">Server</span>
                <span class="font-mono text-[7px] tracking-widest text-dimmed">VALIDATE &middot; DRAIN</span>
              </div>
            </div>

            <div class="mt-6 flex items-center justify-center gap-2">
              <UIcon name="i-lucide-eye-off" class="size-3 text-dimmed" />
              <span class="font-mono text-[9px] text-dimmed">auto-flush on page visibility change</span>
            </div>
          </div>
        </div>
      </Motion>
    </div>
  </section>
</template>

<style scoped>
.pulse-trail {
  position: absolute;
  top: -1px;
  height: 3px;
  width: 30%;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-blue-500) 60%, transparent), transparent);
  animation: pulse-flow 2.5s ease-in-out infinite;
}

.pulse-trail-delayed {
  animation-delay: 0.8s;
}

@keyframes pulse-flow {
  0% { left: -30%; }
  100% { left: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .pulse-trail {
    animation: none;
    display: none;
  }
}
</style>
