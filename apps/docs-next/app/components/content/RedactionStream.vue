<script setup lang="ts">
const fields = redactionFields

const ROW_HEIGHT = 36
const ROW = 300

const scanned = ref(0)

const { root, finished, still, playing, duration, replay } = useFigure({
  steps: fields.map((_, i) => ({ at: 300 + i * ROW, run: () => {
    scanned.value = i + 1
  } })),
  reset: () => {
    scanned.value = 0
  },
  settle: () => {
    scanned.value = fields.length
  },
})

const scanning = computed(() => scanned.value > 0 && scanned.value < fields.length)
</script>

<template>
  <DocsFigure
    ref="root"
    caption="The event as a drain receives it in production. Values keep enough shape to debug; a key that names a secret loses its value entirely."
    :finished
    :still
    :playing
    :duration
    @replay="replay"
  >
    <div class="relative overflow-x-auto px-5 py-4 sm:px-6">
      <span
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 top-4 h-px bg-(--d-signal) transition-[transform,opacity] ease-(--d-ease-move)"
        :style="{
          transform: `translateY(${scanned * ROW_HEIGHT}px)`,
          opacity: scanning ? 1 : 0,
          transitionDuration: `${ROW}ms, 240ms`,
        }"
      />

      <dl class="min-w-[30rem] font-mono text-[12.5px]">
        <div
          v-for="(field, i) in fields"
          :key="field.key"
          class="grid grid-cols-[11rem_minmax(0,1fr)_5.5rem] items-center gap-4"
          :style="{ height: `${ROW_HEIGHT}px` }"
        >
          <dt class="truncate text-dimmed">
            {{ field.key }}
          </dt>
          <dd class="d-stack min-w-0">
            <span class="d-xfade truncate text-default" :data-on="!(field.masked && scanned > i)">{{ field.raw }}</span>
            <span v-if="field.masked" class="d-xfade truncate text-highlighted" :data-on="scanned > i">{{ field.masked }}</span>
          </dd>
          <dd
            class="text-right font-sans text-[12.5px] transition-opacity duration-300"
            :class="[scanned > i ? 'opacity-100' : 'opacity-0', field.rule ? 'text-(--d-signal-text)' : 'text-dimmed']"
          >
            {{ field.rule ?? 'unchanged' }}
          </dd>
        </div>
      </dl>
    </div>
  </DocsFigure>
</template>
