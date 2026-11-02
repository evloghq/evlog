<script setup lang="ts">
import { Motion } from 'motion-v'

const { public: pub } = useRuntimeConfig()
const justUseEvlogUrl = computed(() =>
  typeof pub.justUseEvlogUrl === 'string' ? pub.justUseEvlogUrl.trim() : '',
)

const shipByTime = ref('')

let clockInterval: ReturnType<typeof setInterval> | undefined

function updateShipByTime() {
  const now = new Date()
  now.setMinutes(now.getMinutes() + 10)
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  shipByTime.value = `${h}:${m}`
}

onMounted(() => {
  updateShipByTime()
  clockInterval = setInterval(updateShipByTime, 1_000)
})

onBeforeUnmount(() => {
  if (clockInterval) clearInterval(clockInterval)
})
</script>

<template>
  <section class="relative overflow-hidden flex flex-col" data-section="landing-cta">
    <div
      class="absolute inset-x-0 top-0 h-24 z-[1] pointer-events-none"
      style="background: linear-gradient(180deg, #09090b 0%, transparent 100%)"
    />

    <div
      class="absolute inset-0"
      style="background: linear-gradient(180deg, #09090b 0%, #000711 6%, #001133 14%, #002266 22%, #0044CC 32%, #0055FF 42%, #0077FF 52%, #0099FF 62%, #44BBFF 72%, #88D4FF 80%, #BBE6FF 88%, #E0F3FF 94%, #FFFFFF 100%)"
    />

    <div class="relative z-10 pt-24 md:pt-32 text-center max-w-2xl mx-auto px-6">
      <Motion
        :initial="false"
        :while-in-view="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5 }"
        :in-view-options="{ once: true }"
      >
        <div>
          <div class="relative mb-6">
            <h2 class="section-title text-center text-shadow-lg text-shadow-black">
              Better logging<br>by
              <ClientOnly>
                <span class="tabular-nums">{{ shipByTime }}</span>
                <template #fallback>
                  <span>tonight</span>
                </template>
              </ClientOnly>
              <span class="cta-dot">.</span>
            </h2>
          </div>
          <p class="text-base leading-relaxed text-highlighted mb-10">
            <slot name="description" mdc-unwrap="p" />
          </p>

          <div class="flex flex-wrap items-center justify-center gap-4">
            <UButton
              to="/start/installation"
              size="lg"
              class="bg-white hover:bg-white/90 text-black border-0"
            >
              Get Started
              <template #trailing>
                <UIcon name="i-lucide-arrow-right" class="size-4" />
              </template>
            </UButton>
            <UButton
              v-if="justUseEvlogUrl"
              :to="justUseEvlogUrl"
              target="_blank"
              size="lg"
              class="bg-white/10 border border-white/40 text-white hover:bg-white/20 backdrop-blur-sm"
            >
              <template #leading>
                <UIcon name="i-lucide-megaphone" class="size-4" />
              </template>
              Just fucking use evlog
            </UButton>
            <UButton
              to="https://github.com/evloghq/evlog"
              target="_blank"
              size="lg"
              class="bg-white/10 border border-white/40 text-white hover:bg-white/20 backdrop-blur-sm"
            >
              <template #leading>
                <UIcon name="i-simple-icons-github" class="size-4" />
              </template>
              View on GitHub
            </UButton>
          </div>
        </div>
      </Motion>
    </div>

    <!-- Keeps the gradient's original height now that the footer sits below it. -->
    <div class="relative z-10 mt-auto pt-32 md:pt-44 pb-4" aria-hidden="true">
      <div class="h-4" />
    </div>
  </section>
  <LandingFooter />
</template>

<style scoped>
.cta-dot {
  animation: pulse-dot 1s steps(1) infinite;
}

@keyframes pulse-dot {
  0%, 45% { opacity: 1; }
  50%, 95% { opacity: 0; }
  100% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .cta-dot {
    animation: none;
  }
}
</style>
