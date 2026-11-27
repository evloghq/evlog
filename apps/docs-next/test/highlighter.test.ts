import { createMarkdownParser } from 'comark'
import { renderHtmlFromDocument } from 'comark/render/html'
import { describe, expect, it } from 'vitest'
import highlighter from '../highlighter'

const parse = createMarkdownParser({ plugins: [highlighter] })

async function render(lang: string, code: string) {
  return renderHtmlFromDocument(await parse(`\`\`\`${lang}\n${code}\n\`\`\`\n`))
}

// Geist dark colours, as emitted in `--shiki-dark`.
const KEYWORD = '--shiki-dark:#ff518d'
const STRING = '--shiki-dark:#00ca52'

describe('code highlighting', () => {
  it('highlights LogQL', async () => {
    const html = await render('logql', '{service="my-app"} | json | status >= 500')
    expect(html).toMatch(new RegExp(`${KEYWORD}">json<`))
    expect(html).toMatch(new RegExp(`${STRING}">"my-app"<`))
  })

  it('highlights APL as Kusto, with calls coloured as functions rather than keywords', async () => {
    const html = await render('apl', `['logs'] | summarize count() by path`)
    expect(html).toMatch(new RegExp(`${KEYWORD}">summarize<`))
    expect(html).not.toMatch(new RegExp(`${KEYWORD}">count<`))
    expect(html).toMatch(/shj-func[^>]*>count</)
  })

  it('leaves text uncoloured, quoted strings included', async () => {
    const html = await render('text', 'GET "/api/checkout" 200')
    expect(html).not.toContain('shj-syn-')
  })

  it('wraps diff lines by marker and highlights the code inside them', async () => {
    const html = await render('diff', ` const a = 1\n-import { x } from 'old'\n+import { x } from 'new'`)
    const lines = [...html.matchAll(/<span class="line( diff-(add|del))?"/g)].map(match => match[2] ?? 'same')
    expect(lines).toEqual(['same', 'del', 'add'])
    expect(html).toMatch(new RegExp(`${KEYWORD}">import<`))
  })
})
