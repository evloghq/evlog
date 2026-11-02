<template>
  <ul class="my-5 flex list-none flex-col gap-2.5 pl-0 [&>li]:relative [&>li]:pl-5 [&>li]:before:absolute [&>li]:before:top-[0.78em] [&>li]:before:left-1 [&>li]:before:h-px [&>li]:before:w-2 [&>li]:before:rounded-full [&>li]:before:bg-(--ui-text-dimmed)">
    <slot />
  </ul>
</template>
