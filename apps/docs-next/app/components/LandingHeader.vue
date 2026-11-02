<template>
  <header class="absolute inset-x-0 top-0 z-50">
    <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
      <NuxtLink to="/" aria-label="evlog">
        <DocsLogo />
      </NuxtLink>
      <nav class="flex items-center gap-6 text-[14px]">
        <NuxtLink to="/start/introduction" class="text-muted transition-colors hover:text-highlighted">
          Docs
        </NuxtLink>
        <NuxtLink to="https://github.com/evloghq/evlog" target="_blank" class="text-muted transition-colors hover:text-highlighted">
          GitHub
        </NuxtLink>
      </nav>
    </div>
  </header>
</template>
