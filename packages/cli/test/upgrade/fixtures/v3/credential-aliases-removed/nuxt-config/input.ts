export default defineNuxtConfig({
  modules: ['evlog/nuxt'],
  evlog: {
    axiom: {
      dataset: 'logs',
      token: process.env.NUXT_AXIOM_API_KEY,
    },
  },
})
