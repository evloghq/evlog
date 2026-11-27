<script setup lang="ts">
import { Motion } from 'motion-v'
</script>

<template>
  <section class="py-24 md:py-32" data-section="landing-faq">
    <div class="mx-auto max-w-3xl px-6">
      <Motion
        :initial="false"
        :while-in-view="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5 }"
        :in-view-options="{ once: true }"
      >
        <div>
          <p v-if="$slots.headline" class="section-label justify-center">
            <slot name="headline" mdc-unwrap="p" />
          </p>
          <div class="relative mb-10 text-center">
            <h2 class="section-title">
              <slot name="title" mdc-unwrap="p" /><span class="text-primary">.</span>
            </h2>
            <div aria-hidden="true" class="title-glow section-title">
              <slot name="title" mdc-unwrap="p" /><span class="text-primary">.</span>
            </div>
          </div>
        </div>
      </Motion>

      <Motion
        :initial="false"
        :while-in-view="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.5, delay: 0.1 }"
        :in-view-options="{ once: true }"
      >
        <slot name="body" />
      </Motion>
    </div>
  </section>
</template>
