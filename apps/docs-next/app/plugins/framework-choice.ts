import { frameworks } from '~/utils/frameworks'

// Docs pages are prerendered, so the server never sees the reader's cookie.
// This runs before first paint and stamps the choice on <html>; CSS keyed on it
// shows the reader's framework everywhere, so hydration meets the same markup it
// rendered and nothing flashes or shifts.
//
// - `[data-fw-only="id"]` shows only while that framework is chosen.
// - `[data-fw-none]` shows only while none is.
// - `[data-fw-item="id"]` (sidebar entries) hides when another framework is chosen.
// - `[data-fw-other="id"]` shows only while a different framework is chosen.
export default defineNuxtPlugin(() => {
  const ids = frameworks.map(f => f.id)
  const hide = (selector: string) => `${selector}{display:none!important}`
  const css = [
    hide('html:not([data-framework]) [data-fw-only]'),
    hide('html[data-framework] [data-fw-none]'),
    hide('html:not([data-framework]) [data-fw-other]'),
    ...ids.flatMap(id => [
      hide(`html[data-framework="${id}"] [data-fw-only]:not([data-fw-only="${id}"])`),
      hide(`html[data-framework="${id}"] [data-fw-item]:not([data-fw-item="${id}"])`),
      hide(`html[data-framework="${id}"] [data-fw-other="${id}"]`),
    ]),
  ].join('\n')

  useHead({
    script: [
      {
        key: 'framework-choice',
        tagPosition: 'head',
        innerHTML: `(function(){var m=document.cookie.match(/(?:^|; )evlog-framework=([^;]*)/);var v=m&&decodeURIComponent(m[1]);if(v&&${JSON.stringify(ids)}.indexOf(v)>-1)document.documentElement.dataset.framework=v})()`,
      },
    ],
    style: [{ key: 'framework-only', innerHTML: css }],
  })
})
