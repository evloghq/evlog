import { START_LOCATION } from 'vue-router'

// Times every page the reader opens: the document request on first load, the route change after that.
export default defineNuxtPlugin((nuxtApp) => {
  const request = useDocsRequest()
  const navigated = useDocsNavigated()
  const router = useRouter()
  let started: number | undefined

  router.beforeEach((to, from) => {
    if (from === START_LOCATION || to.path === from.path) return
    started = performance.now()
    navigated.value = true
  })

  nuxtApp.hook('page:finish', () => {
    const { path } = router.currentRoute.value
    if (started !== undefined) {
      request.value = { path, status: 200, ms: performance.now() - started }
      started = undefined
      return
    }
    if (request.value) return
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
    // Safari does not report the status. This page rendered, so the document was served.
    if (entry) request.value = { path, status: entry.responseStatus || 200, ms: entry.responseEnd }
  })
})
