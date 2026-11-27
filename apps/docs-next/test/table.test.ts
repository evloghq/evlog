import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { isPhrase, isRowName, nodeText } from '../app/utils/table'

describe('a table cell', () => {
  it('reads its text through elements and through the slots of components', () => {
    const code = { render: () => null }
    const cell = ['A route, with ', h('a', { href: '/integrations' }, 'an integration'), ' or ', h(code, null, { default: () => ['req.log'] })]

    expect(nodeText(cell)).toBe('A route, with an integration or req.log')
  })

  it('keeps a name on one line and lets a sentence wrap', () => {
    expect(isRowName('Cloudflare Workers')).toBe(true)
    expect(isRowName('include / exclude')).toBe(true)
    expect(isRowName('A route, with a framework integration')).toBe(false)
  })

  it('lets code wrap only when it is long and has spaces to break at', () => {
    expect(isPhrase('Record<string, { service }>')).toBe(true)
    expect(isPhrase('context.get(loggerContext)')).toBe(false)
    expect(isPhrase('boolean | object')).toBe(false)
  })
})
