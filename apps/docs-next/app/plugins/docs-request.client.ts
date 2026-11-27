import { START_LOCATION } from 'vue-router'

// Times every page the reader opens: the document request on first load, the route change after that.
export default defineNuxtPlugin((nuxtApp) => {
  const request = useDocsRequest()
  const navigated = useDocsNavigated()
  const router = useRouter()
  const clock = createRequestClock()
  let documentPage = true

  router.beforeEach((to, from) => {
    if (from === START_LOCATION || to.path === from.path) return
    clock.start(to.path, performance.now())
    navigated.value = true
  })

  nuxtApp.hook('page:finish', () => {
    const { path } = router.currentRoute.value
    const timed = clock.finish(path, performance.now())
    if (timed) {
      request.value = { ...timed, status: 200 }
    } else if (documentPage && !clock.navigating) {
      const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
      // Safari does not report the status. This page rendered, so the document was served.
      if (entry) request.value = { path, status: entry.responseStatus || 200, ms: entry.responseEnd }
    }
    documentPage = false
  })
})
