<script setup lang="ts">
const props = withDefaults(defineProps<{
  /** Whether live refresh is on (user toggle + tab visible, not suspended). */
  live: boolean
  /** The last poll failed — dashboard data may be stale despite still polling. */
  hasError?: boolean
  /** Newest event timestamp in the current filter — `null` when there is no data. */
  lastEventAt: string | null
}>(), {
  hasError: false,
})

const emit = defineEmits<{ toggle: [] }>()

// Ticks every second so "12s ago" stays honest between polls.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

const lastEventLabel = computed(() => {
  if (!props.lastEventAt) return null
  const seconds = Math.max(0, Math.floor((now.value - new Date(props.lastEventAt).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
})

// Still polling but the last tick failed — data may be stale even though the
// toggle says "live". Distinct from "Paused" (user intent) and "Live" (healthy).
const stalled = computed(() => props.live && props.hasError)
const dotClass = computed(() => {
  if (stalled.value) return 'bg-warning'
  return props.live ? 'bg-success' : 'bg-neutral-500'
})
const label = computed(() => {
  if (stalled.value) return 'Reconnecting'
  return props.live ? 'Live' : 'Paused'
})
</script>

<template>
  <div class="flex h-8 items-center gap-2 rounded-[--ui-radius] border border-default bg-elevated/40 pl-2.5 pr-1 text-xs" :title="stalled ? 'Live refresh is failing — showing the last data that loaded successfully.' : undefined">
    <span class="relative flex size-2">
      <span
        v-if="live"
        class="absolute inline-flex h-full w-full animate-ping rounded-full motion-reduce:animate-none"
        :class="stalled ? 'bg-warning/60' : 'bg-success/60'"
      />
      <span
        class="relative inline-flex size-2 rounded-full transition-colors duration-200"
        :class="dotClass"
      />
    </span>
    <span class="font-medium" :class="stalled ? 'text-warning' : live ? 'text-success' : 'text-muted'">
      {{ label }}
    </span>
    <template v-if="lastEventLabel">
      <span aria-hidden="true" class="h-3 w-px bg-border" />
      <span class="text-muted tabular-nums">last event {{ lastEventLabel }}</span>
    </template>
    <UButton
      variant="ghost"
      color="neutral"
      size="xs"
      :icon="live ? 'i-nucleo-pause' : 'i-nucleo-play'"
      :aria-label="live ? 'Pause live refresh' : 'Resume live refresh'"
      @click="emit('toggle')"
    />
  </div>
</template>
