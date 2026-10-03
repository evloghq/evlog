import { frameworks } from '~/utils/frameworks'

// Docs pages are prerendered, so the server never sees the reader's cookie.
// This runs before first paint and stamps the choice on <html>; the CSS in
// FrameworkTabs selects the visible tab from it, so hydration meets the same
// markup it rendered and nothing flashes or shifts.
export default defineNuxtPlugin(() => {
  const ids = JSON.stringify(frameworks.map(f => f.id))
  useHead({
    script: [
      {
        key: 'framework-choice',
        tagPosition: 'head',
        innerHTML: `(function(){var m=document.cookie.match(/(?:^|; )evlog-framework=([^;]*)/);var v=m&&decodeURIComponent(m[1]);if(v&&${ids}.indexOf(v)>-1)document.documentElement.dataset.framework=v})()`,
      },
    ],
  })
})
