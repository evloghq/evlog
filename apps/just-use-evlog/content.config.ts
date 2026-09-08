import { defineCollection, defineContentConfig, z } from '@nuxt/content'

export default defineContentConfig({
  collections: {
    landing: defineCollection({
      type: 'page',
      source: '**/*.md',
      schema: z.object({
        ogTitle: z.string().optional(),
        ogDescription: z.string().optional(),
      }),
    }),
  },
})
