<script setup lang="ts">
type LogoItem = {
  name: string
  href: string
  icon: string
  wordmarkClass: string
}

const logos: LogoItem[] = [
  { name: 'Vercel', href: 'https://vercel.com', icon: 'i-custom:vercel', wordmarkClass: 'h-7 w-[7.6rem] sm:h-10 sm:w-[10.9rem] shrink-0' },
  { name: 'Nuxt', href: 'https://nuxt.com', icon: 'i-custom:nuxt', wordmarkClass: 'h-7 w-[6rem] sm:h-10 sm:w-[8.5rem] shrink-0' },
  { name: 'Prisma', href: 'https://www.prisma.io', icon: 'i-custom:prisma', wordmarkClass: 'h-7 w-[5rem] sm:h-10 sm:w-[7.2rem] shrink-0' },
  { name: 'Adobe', href: 'https://www.adobe.com', icon: 'i-custom:adobe', wordmarkClass: 'h-7 w-[6.8rem] sm:h-10 sm:w-[9.75rem] shrink-0' },
  { name: 'INTH', href: 'https://inth.com/', icon: 'i-custom:inth', wordmarkClass: 'h-7 w-[5.5rem] sm:h-10 sm:w-[7.8rem] shrink-0' },
  { name: 'Databuddy', href: 'https://www.databuddy.cc', icon: 'i-custom:databuddy', wordmarkClass: 'h-7 w-[7.4rem] sm:h-10 sm:w-[10.6rem] shrink-0' },
]
</script>

<template>
  <section
    class="relative -mt-4 pt-4"
    data-section="landing-logos"
    aria-label="Companies using evlog"
  >
    <div
      class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/[0.04] to-transparent"
      aria-hidden="true"
    />

    <p class="relative z-10 mb-10 text-center font-pixel text-[10px] uppercase tracking-[0.24em] text-dimmed">
      Used by
    </p>

    <div
      class="relative z-0 mx-auto grid max-w-4xl grid-cols-2 place-items-center gap-x-4 gap-y-8 px-4 md:grid-cols-3 md:gap-x-10 md:gap-y-10 md:px-8"
    >
      <LandingLogoLink
        v-for="logo in logos"
        :key="logo.name"
        v-bind="logo"
      />
    </div>
  </section>
</template>
