<script setup lang="ts">
import { Motion } from 'motion-v'

const prefersReducedMotion = ref(false)
const activeOutput = ref<'success' | 'error'>('success')
const outputRef = ref<HTMLElement>()

let cycleInterval: ReturnType<typeof setInterval> | undefined
let observer: IntersectionObserver | undefined

const props = defineProps<{
  link?: string
  linkLabel?: string
}>()

const pills = [
  { label: 'Wide events', icon: 'i-lucide-layers' },
  { label: 'Root cause', icon: 'i-lucide-search' },
  { label: 'Fix suggestion', icon: 'i-lucide-wrench' },
]

onMounted(() => {
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!prefersReducedMotion.value && outputRef.value) {
    observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !cycleInterval) {
          cycleInterval = setInterval(() => {
            activeOutput.value = activeOutput.value === 'success' ? 'error' : 'success'
          }, 3500)
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(outputRef.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  if (cycleInterval) clearInterval(cycleInterval)
})

function setOutput(type: 'success' | 'error') {
  activeOutput.value = type
  if (cycleInterval) {
    clearInterval(cycleInterval)
    cycleInterval = undefined
  }
}
</script>

<template>
  <section class="pt-16 md:pt-20 pb-24 md:pb-32" data-section="features-feature-simple-api">
    <Motion
      :initial="false"
      :while-in-view="{ opacity: 1, y: 0 }"
      :transition="{ duration: 0.5 }"
      :in-view-options="{ once: true }"
      class="mb-10"
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
            <UIcon :name="pill.icon" class="size-3 text-emerald-500" />
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
        <div class="h-full overflow-hidden border border-muted bg-default">
          <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
            <div class="flex gap-1.5">
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
            </div>
            <span class="ml-3 font-mono text-xs text-dimmed">checkout.post.ts</span>
          </div>
          <div class="p-5 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto">
            <pre><code><span class="text-violet-400">export default</span> <span class="text-amber-400">defineEventHandler</span>(<span class="text-violet-400">async</span> (event) => {
  <span class="text-violet-400">const</span> log = <span class="text-amber-400">useLogger</span>(event)

  log.<span class="text-amber-400">set</span>({ <span class="text-sky-400">user</span>: { <span class="text-sky-400">id</span>: user.id, <span class="text-sky-400">plan</span>: user.plan } })
  log.<span class="text-amber-400">set</span>({ <span class="text-sky-400">cart</span>: { <span class="text-sky-400">items</span>: <span class="text-pink-400">3</span>, <span class="text-sky-400">total</span>: <span class="text-pink-400">9999</span> } })

  <span class="text-violet-400">if</span> (!charge.success) {
    <span class="text-violet-400">throw</span> <span class="text-amber-400">createError</span>({
      <span class="text-sky-400">status</span>: <span class="text-pink-400">402</span>,
      <span class="text-sky-400">why</span>: <span class="text-emerald-400">'Card declined by issuer'</span>,
      <span class="text-sky-400">fix</span>: <span class="text-emerald-400">'Try a different card'</span>,
    })
  }

  <span class="text-violet-400">return</span> { <span class="text-sky-400">orderId</span>: charge.id }
})</code></pre>
          </div>
        </div>
      </Motion>

      <Motion
        :initial="false"
        :while-in-view="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5, delay: 0.2 }"
        :in-view-options="{ once: true }"
      >
        <div ref="outputRef" class="h-full overflow-hidden border border-muted bg-default">
          <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
            <div class="flex gap-1.5">
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
              <div class="size-3 rounded-full bg-accented" />
            </div>
            <span class="ml-3 font-mono text-xs text-dimmed">output</span>
            <div class="ml-auto flex items-center gap-1.5">
              <button
                class="font-mono text-[10px] px-2 py-0.5 border transition-all duration-300 outline-none cursor-pointer"
                :class="activeOutput === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                  : 'border-transparent text-dimmed hover:text-muted'"
                @click="setOutput('success')"
              >
                200
              </button>
              <button
                class="font-mono text-[10px] px-2 py-0.5 border transition-all duration-300 outline-none cursor-pointer"
                :class="activeOutput === 'error'
                  ? 'border-red-500/30 bg-red-500/10 text-red-500'
                  : 'border-transparent text-dimmed hover:text-muted'"
                @click="setOutput('error')"
              >
                402
              </button>
            </div>
          </div>

          <div class="grid [&>*]:col-start-1 [&>*]:row-start-1">
            <div
              class="p-5 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto transition-opacity duration-300"
              :class="activeOutput === 'success' ? 'opacity-100' : 'opacity-0 pointer-events-none'"
            >
              <div class="mb-3 flex items-baseline gap-3">
                <span class="font-medium text-emerald-500">INFO</span>
                <span class="text-violet-400">POST</span>
                <span class="text-amber-400">/api/checkout</span>
                <span class="ml-auto text-dimmed">(234ms)</span>
              </div>
              <div class="space-y-1 border-l-2 border-muted pl-4">
                <div>
                  <span class="text-sky-400">user</span><span class="text-dimmed">:</span>
                  <span class="text-muted"> { id: 1842, plan: "pro" }</span>
                </div>
                <div>
                  <span class="text-sky-400">cart</span><span class="text-dimmed">:</span>
                  <span class="text-muted"> { items: 3, total: 9999 }</span>
                </div>
                <div>
                  <span class="text-sky-400">status</span><span class="text-dimmed">:</span>
                  <span class="text-emerald-400"> 200</span>
                </div>
                <div>
                  <span class="text-sky-400">requestId</span><span class="text-dimmed">:</span>
                  <span class="text-dimmed"> "req_8f2k..."</span>
                </div>
              </div>
              <div class="mt-4 border-t border-muted pt-3">
                <p class="text-xs text-dimmed">
                  <span class="text-emerald-500">&#10003;</span> One log with full context
                </p>
              </div>
            </div>

            <div
              class="p-5 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto transition-opacity duration-300"
              :class="activeOutput === 'error' ? 'opacity-100' : 'opacity-0 pointer-events-none'"
            >
              <div class="mb-3 flex items-baseline gap-3">
                <span class="font-medium text-red-500">ERROR</span>
                <span class="text-violet-400">POST</span>
                <span class="text-amber-400">/api/checkout</span>
                <span class="ml-auto text-red-500">402</span>
              </div>
              <div class="space-y-1 border-l-2 border-red-500/30 pl-4">
                <div>
                  <span class="text-sky-400">message</span><span class="text-dimmed">:</span>
                  <span class="text-muted"> "Payment failed"</span>
                </div>
                <div>
                  <span class="text-sky-400">why</span><span class="text-dimmed">:</span>
                  <span class="text-muted"> "Card declined by issuer"</span>
                </div>
                <div>
                  <span class="text-sky-400">fix</span><span class="text-dimmed">:</span>
                  <span class="text-emerald-400"> "Try a different card"</span>
                </div>
                <div>
                  <span class="text-sky-400">user</span><span class="text-dimmed">:</span>
                  <span class="text-muted"> { id: 1842, plan: "pro" }</span>
                </div>
              </div>
              <div class="mt-4 border-t border-muted pt-3">
                <p class="text-xs text-dimmed">
                  <span class="text-emerald-500">&#10003;</span> Actionable error with context
                </p>
              </div>
            </div>
          </div>
        </div>
      </Motion>
    </div>
  </section>
</template>
