export default defineNuxtRouteMiddleware((to) => {
  to.meta.colorMode = 'dark'
})
