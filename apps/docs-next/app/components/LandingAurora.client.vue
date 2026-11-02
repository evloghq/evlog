<script setup lang="ts">
import { Shader, Aurora } from 'shaders/vue'
</script>

<template>
  <div class="absolute inset-0 mix-blend-screen opacity-30">
    <div class="size-full">
      <Shader>
        <Aurora
          color-a="#0044CC"
          color-b="#0088FF"
          color-c="#66BBFF"
          :speed="2"
          :intensity="50"
          :curtain-count="3"
          :waviness="35"
          :ray-density="12"
          :height="150"
        />
      </Shader>
    </div>
  </div>
</template>
