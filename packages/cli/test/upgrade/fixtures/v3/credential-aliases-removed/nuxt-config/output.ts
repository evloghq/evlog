export default defineNuxtConfig({
  modules: ['evlog/nuxt'],
  evlog: {
    axiom: {
      dataset: 'logs',
      apiKey: process.env.NUXT_AXIOM_API_KEY,
    },
  },
})
