<script setup lang="ts">
interface Enricher {
  header: string
  raw: string
  key: string
  value: string
}

const enrichers: Enricher[] = [
  { header: 'user-agent', raw: 'Mozilla/5.0 (Macintosh) Chrome/120.0', key: 'userAgent', value: 'browser=Chrome os=macOS' },
  { header: 'x-vercel-ip-country', raw: 'FR', key: 'geo', value: 'country=FR' },
  { header: 'content-length', raw: '1248', key: 'requestSize', value: 'requestBytes=1248' },
  { header: 'traceparent', raw: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', key: 'traceContext', value: 'traceId=4bf92f35…' },
]

const ran = ref(0)

const STEP = 650

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: enrichers.map((_, i) => ({ at: 400 + i * STEP, run: () => {
    ran.value = i + 1
  } })),
  reset: () => {
    ran.value = 0
  },
  settle: () => {
    ran.value = enrichers.length
  },
})
</script>

<template>
  <DocsFigure
    ref="root"
    caption="createDefaultEnrichers() on one request. Each enricher reads a header and adds one field; the handler sets none of them."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div class="border-b border-(--d-line) p-5 md:border-r md:border-b-0">
        <p class="mb-4 text-[13px] text-dimmed">
          Request headers
        </p>
        <ul class="flex flex-col font-mono text-[12px]/5">
          <li
            v-for="(enricher, i) in enrichers"
            :key="enricher.header"
            class="flex h-7 min-w-0 items-center gap-2"
          >
            <span
              class="size-[5px] shrink-0 rounded-full transition-colors duration-300"
              :class="ran === i + 1 ? 'bg-(--d-signal)' : 'bg-(--d-line-strong)'"
            />
            <span class="shrink-0 transition-colors duration-300" :class="ran > i ? 'text-default' : 'text-muted'">{{ enricher.header }}:</span>
            <span class="truncate text-dimmed">{{ enricher.raw }}</span>
          </li>
        </ul>
      </div>

      <div class="p-5">
        <p class="mb-4 text-[13px] text-dimmed">
          The event
        </p>
        <div class="font-mono text-[12px]/5">
          <p class="flex gap-2 truncate text-highlighted">
            <span class="text-dimmed">INFO</span>
            <span>POST /api/checkout</span>
            <span class="text-(--d-signal-text)">200</span>
          </p>
          <ul class="d-rail ml-[3px] [--rail-mid:12px]">
            <li>
              <span class="block truncate py-0.5">
                <span class="text-muted">user:</span>
                <span class="ml-[1ch] text-default">id=usr_123</span>
              </span>
            </li>
            <li
              v-for="(enricher, i) in enrichers"
              :key="enricher.key"
              class="d-step"
              :data-on="ran > i"
            >
              <span class="block truncate py-0.5">
                <span class="text-muted">{{ enricher.key }}:</span>
                <span class="ml-[1ch] text-default">{{ enricher.value }}</span>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </DocsFigure>
</template>
