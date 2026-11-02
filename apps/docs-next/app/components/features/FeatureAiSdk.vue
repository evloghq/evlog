<script setup lang="ts">
import { Motion } from 'motion-v'

const prefersReducedMotion = ref(false)
const activeView = ref<'without' | 'with'>('without')
const panelRef = ref<HTMLElement>()

let cycleInterval: ReturnType<typeof setInterval> | undefined
let observer: IntersectionObserver | undefined

const props = defineProps<{
  link?: string
  linkLabel?: string
}>()

const pills = [
  { label: 'Token tracking', icon: 'i-lucide-coins' },
  { label: 'Tool calls', icon: 'i-lucide-wrench' },
  { label: 'Streaming metrics', icon: 'i-lucide-gauge' },
  { label: 'Cost estimation', icon: 'i-lucide-dollar-sign' },
  { label: 'Tool timing', icon: 'i-lucide-timer' },
]

const benefits = [
  {
    icon: 'i-lucide-zap',
    title: 'Zero boilerplate',
    text: 'Wrap the model, done. No manual token tracking needed.',
  },
  {
    icon: 'i-lucide-box',
    title: 'Works with everything',
    text: 'generateText, streamText, ToolLoopAgent, embed, multi-step agents.',
  },
  {
    icon: 'i-lucide-bar-chart-3',
    title: 'Cost and performance',
    text: 'Token usage, cache hits, cost estimation, time to first chunk, tokens per second.',
  },
  {
    icon: 'i-lucide-timer',
    title: 'Telemetry integration',
    text: 'Per-tool execution timing, success/failure tracking, and total generation wall time.',
  },
]

onMounted(() => {
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!prefersReducedMotion.value && panelRef.value) {
    observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !cycleInterval) {
          cycleInterval = setInterval(() => {
            activeView.value = activeView.value === 'without' ? 'with' : 'without'
          }, 4000)
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(panelRef.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  if (cycleInterval) clearInterval(cycleInterval)
})

function setView(view: 'without' | 'with') {
  activeView.value = view
  if (cycleInterval) {
    clearInterval(cycleInterval)
    cycleInterval = undefined
  }
}
</script>

<template>
  <section class="py-24 md:py-32" data-section="features-feature-ai-sdk">
    <div class="grid gap-6 lg:grid-cols-2 *:min-w-0">
      <div class="flex flex-col gap-6">
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
                <UIcon :name="pill.icon" class="size-3 text-sky-500" />
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
          <div class="space-y-4">
            <div
              v-for="benefit in benefits"
              :key="benefit.title"
              class="flex items-start gap-3"
            >
              <UIcon :name="benefit.icon" class="size-4 mt-0.5 shrink-0 text-sky-500" />
              <div>
                <p class="font-mono text-xs text-highlighted">
                  {{ benefit.title }}
                </p>
                <p class="mt-0.5 text-xs leading-relaxed text-dimmed">
                  {{ benefit.text }}
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
        <div ref="panelRef" class="overflow-hidden border border-muted bg-default">
          <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
            <div class="flex gap-1.5">
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
            </div>
            <span class="ml-3 font-mono text-xs text-dimmed">wide event</span>
            <div class="ml-auto flex items-center gap-1.5">
              <button
                class="font-mono text-[10px] px-2 py-0.5 border transition-all duration-300 outline-none cursor-pointer"
                :class="activeView === 'without'
                  ? 'border-accented/30 bg-accented/10 text-muted'
                  : 'border-transparent text-dimmed hover:text-muted'"
                @click="setView('without')"
              >
                before
              </button>
              <button
                class="font-mono text-[10px] px-2 py-0.5 border transition-all duration-300 outline-none cursor-pointer"
                :class="activeView === 'with'
                  ? 'border-sky-500/30 bg-sky-500/10 text-sky-500'
                  : 'border-transparent text-dimmed hover:text-muted'"
                @click="setView('with')"
              >
                + evlog/ai
              </button>
            </div>
          </div>

          <div class="px-5 pt-4 pb-3 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto border-b border-muted/50">
            <pre><code><span class="text-violet-400">const</span> ai = <span class="text-amber-400">createAILogger</span>(log, {
  <span class="text-sky-400">cost</span>: { <span class="text-emerald-400">'claude-sonnet-4.6'</span>: { <span class="text-sky-400">input</span>: <span class="text-pink-400">3</span>, <span class="text-sky-400">output</span>: <span class="text-pink-400">15</span> } },
})

<span class="text-violet-400">const</span> result = <span class="text-amber-400">streamText</span>({
  <span class="text-sky-400">model</span>: ai.<span class="text-amber-400">wrap</span>(<span class="text-emerald-400">'anthropic/claude-sonnet-4.6'</span>),
  messages,
  <span class="text-sky-400">telemetry</span>: {
    <span class="text-sky-400">integrations</span>: [<span class="text-amber-400">createEvlogIntegration</span>(ai)],
  },
})</code></pre>
          </div>

          <div class="grid [&>*]:col-start-1 [&>*]:row-start-1">
            <div
              class="p-5 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto transition-opacity duration-300"
              :class="activeView === 'without' ? 'opacity-100' : 'opacity-0 pointer-events-none'"
            >
              <div class="mb-3 flex items-baseline gap-3">
                <span class="font-medium text-emerald-500">INFO</span>
                <span class="text-violet-400">POST</span>
                <span class="text-amber-400">/api/chat</span>
                <span class="ml-auto text-dimmed">(4.5s)</span>
              </div>
              <div class="space-y-1 border-l-2 border-muted pl-4">
                <div>
                  <span class="text-sky-400">status</span><span class="text-dimmed">:</span>
                  <span class="text-emerald-400"> 200</span>
                </div>
                <div>
                  <span class="text-sky-400">requestId</span><span class="text-dimmed">:</span>
                  <span class="text-dimmed"> "req_8f2k..."</span>
                </div>
              </div>
              <div class="mt-4 text-xs text-dimmed italic">
                Which model? How many tokens? What did it cost?
              </div>
            </div>

            <div
              class="p-5 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto transition-opacity duration-300"
              :class="activeView === 'with' ? 'opacity-100' : 'opacity-0 pointer-events-none'"
            >
              <div class="mb-3 flex items-baseline gap-3">
                <span class="font-medium text-emerald-500">INFO</span>
                <span class="text-violet-400">POST</span>
                <span class="text-amber-400">/api/chat</span>
                <span class="ml-auto text-dimmed">(4.5s)</span>
              </div>
              <div class="space-y-1 border-l-2 border-muted pl-4 mb-1">
                <div>
                  <span class="text-sky-400">status</span><span class="text-dimmed">:</span>
                  <span class="text-emerald-400"> 200</span>
                </div>
              </div>
              <div class="space-y-1 border-l-2 border-sky-500/20 pl-4">
                <div>
                  <span class="text-sky-400">ai.model</span><span class="text-dimmed">:</span>
                  <span class="text-muted"> "claude-sonnet-4.6"</span>
                </div>
                <div>
                  <span class="text-sky-400">ai.inputTokens</span><span class="text-dimmed">:</span>
                  <span class="text-pink-400"> 3312</span>
                </div>
                <div>
                  <span class="text-sky-400">ai.outputTokens</span><span class="text-dimmed">:</span>
                  <span class="text-pink-400"> 814</span>
                </div>
                <div>
                  <span class="text-sky-400">ai.reasoningTokens</span><span class="text-dimmed">:</span>
                  <span class="text-pink-400"> 225</span>
                </div>
                <div>
                  <span class="text-sky-400">ai.toolCalls</span><span class="text-dimmed">:</span>
                  <span class="text-amber-400"> ["searchWeb", "queryDB"]</span>
                </div>
                <div>
                  <span class="text-sky-400">ai.tools</span><span class="text-dimmed">:</span>
                  <span class="text-amber-400"> [{name: "searchWeb", durationMs: 150, ...}]</span>
                </div>
                <div>
                  <span class="text-sky-400">ai.estimatedCost</span><span class="text-dimmed">:</span>
                  <span class="text-emerald-400"> 0.022</span>
                </div>
                <div>
                  <span class="text-sky-400">ai.msToFirstChunk</span><span class="text-dimmed">:</span>
                  <span class="text-emerald-400"> 234</span>
                </div>
                <div>
                  <span class="text-sky-400">ai.tokensPerSecond</span><span class="text-dimmed">:</span>
                  <span class="text-emerald-400"> 180</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Motion>
    </div>
  </section>
</template>
