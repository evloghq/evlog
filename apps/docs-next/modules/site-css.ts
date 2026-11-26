import { createResolver, defineNuxtModule } from '@nuxt/kit'

// Stand-in for the layer's `comarkDocs.css` option, which is not on comark-docs `main` yet: the site's
// stylesheet has to be imported from the layer's Tailwind entry, or its `@theme` and `@apply` compile
// without the theme.
export default defineNuxtModule({
  meta: { name: 'evlog-docs/site-css' },
  setup(_options, nuxt) {
    const { resolve } = createResolver(nuxt.options.srcDir)
    const site = resolve('assets/css/main.css')

    nuxt.hook('app:templates', (app) => {
      const entry = app.templates.find(template => template.filename === 'comark-docs.css')
      if (!entry?.getContents) throw new Error('comark-docs.css template not found')
      // The hook runs again on every rebuild of the templates, with the same template object.
      const wrapped = entry as typeof entry & { withSiteCss?: boolean }
      if (wrapped.withSiteCss) return
      wrapped.withSiteCss = true
      const { getContents } = entry
      entry.getContents = async data => `${await getContents(data)}@import ${JSON.stringify(site)};\n`
    })
  },
})
