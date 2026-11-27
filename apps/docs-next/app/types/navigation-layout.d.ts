declare module 'nuxt/app' {
  interface NuxtLayouts {
    docs: Record<string, never>
    page: Record<string, never>
  }
}

export {}
