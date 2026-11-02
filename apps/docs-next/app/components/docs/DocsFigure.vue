<script setup lang="ts">
const props = defineProps<{
  /** One sentence under the frame saying what the figure shows. */
  caption?: string
  /** Shows the Replay button once the figure has played. */
  finished?: boolean
  /** Reduced motion: the figure never plays, so there is nothing to replay. */
  still?: boolean
}>()

defineEmits<{ replay: [] }>()
</script>

<template>
  <figure class="not-prose my-10">
    <div class="group/fig relative overflow-hidden rounded-(--d-r-lg) border border-(--d-line) bg-(--d-raised)">
      <slot />

      <button
        v-if="!props.still"
        type="button"
        class="absolute right-3 bottom-3 rounded-(--d-r-md) bg-default/70 px-2.5 py-1 text-[12.5px] text-dimmed ring-1 ring-(--d-line) backdrop-blur transition-[opacity,color,transform] duration-200 ring-inset hover:text-highlighted focus-visible:opacity-100 active:scale-[0.97]"
        :class="props.finished ? 'opacity-0 group-hover/fig:opacity-100' : 'pointer-events-none opacity-0'"
        :tabindex="props.finished ? 0 : -1"
        @click="$emit('replay')"
      >
        Replay
      </button>
    </div>

    <figcaption v-if="props.caption" class="mt-3 px-1 text-[13px]/5 text-pretty text-dimmed">
      {{ props.caption }}
    </figcaption>
  </figure>
</template>
