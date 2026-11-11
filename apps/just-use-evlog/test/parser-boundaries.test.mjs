import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { defineMarkdownDocumentComponent } from '@comark/vue'
import { parseMarkdown as parseMdc } from '@nuxtjs/mdc/runtime'
import { renderToString } from '@vue/server-renderer'
import { parseMarkdown } from 'comark'
import { createJiti } from 'jiti'
import { createSSRApp, defineComponent, h } from 'vue'

const Poly = defineComponent({
  props: ['as', 'is', 'tag', 'items', 'options'],
  setup(props) {
    return () => h(props.as || props.is || props.tag || 'div', {
      'data-options': JSON.stringify(props.options),
    }, props.items ? props.items.map(item => h('span', null, item.label)) : 'poly')
  },
})

const Document = defineMarkdownDocumentComponent({ components: { poly: Poly } })
const rendererPath = fileURLToPath(import.meta.resolve('@nuxtjs/mdc/runtime/components/MDCRenderer.vue'))
// The published renderer is a script-only SFC, so no Nuxt app build is needed.
const rendererScript = readFileSync(rendererPath, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
const { default: MDCRenderer } = await createJiti(import.meta.url).evalModule(rendererScript, {
  filename: rendererPath,
  async: true,
})

async function renderMdc(markdown, data = {}) {
  const parsed = await parseMdc(markdown)
  const app = createSSRApp(MDCRenderer, { body: parsed.body, data: { ...parsed.data, ...data }, prose: false })
  app.component('Poly', Poly)
  return renderToString(app)
}

async function render(markdown) {
  const value = await parseMarkdown(markdown)
  return renderToString(createSSRApp({ render: () => h(Document, { value }) }))
}

for (const prop of ['as', 'is', 'tag']) {
  test(`MDC drops object-valued ${prop}`, async () => {
    const { body } = await parseMdc(`::poly{:${prop}='{"template":"<b>{{ 7 * 191 }}</b>"}'}\n::`)
    assert.deepEqual(body.children[0].props, {})
  })

  test(`MDC SSR drops data-bound object-valued ${prop}`, async () => {
    const html = await renderMdc(`::poly{:${prop}="choice"}\n::`, {
      choice: { template: '<b>{{ 7 * 191 }}</b>' },
    })
    assert.ok(html.includes('<div>poly</div>'))
    assert.ok(!html.includes('1337'))
  })

  test(`Comark SSR drops object-valued ${prop}`, async () => {
    const html = await render(`::poly{:${prop}='{"template":"<b>{{ 7 * 191 }}</b>"}'}\n::`)
    assert.ok(html.includes('<div>poly</div>'))
    assert.ok(!html.includes('1337'))
  })
}

test('MDC keeps string tags and ordinary object and array data', async () => {
  const { body } = await parseMdc('::poly{as="section" :items=\'[{"label":"a"}]\' :options=\'{"k":"v"}\'}\n::')
  assert.deepEqual(body.children[0].props, {
    'as': 'section',
    ':items': '[{"label":"a"}]',
    ':options': '{"k":"v"}',
  })
})

test('MDC SSR keeps string tags and ordinary object and array data', async () => {
  const html = await renderMdc('::poly{:as=\'"section"\' :items=\'[{"label":"a"}]\' :options=\'{"k":"v"}\'}\n::')
  assert.ok(html.includes('<section data-options="{&quot;k&quot;:&quot;v&quot;}"><span>a</span></section>'))
})

test('Comark SSR keeps string tags and ordinary object and array data', async () => {
  const html = await render('::poly{:as=\'"section"\' :items=\'[{"label":"a"}]\' :options=\'{"k":"v"}\'}\n::')
  assert.ok(html.includes('<section data-options="{&quot;k&quot;:&quot;v&quot;}"><span>a</span></section>'))
})
