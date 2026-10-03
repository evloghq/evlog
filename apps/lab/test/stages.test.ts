import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderStageSourceStylesheet, toVitePath, toViteRelativePath } from '../modules/stages'

describe('stage source paths', () => {
  it('writes relative component globs with Vite separators', () => {
    const generated = resolve('apps/lab/.stages')
    const components = resolve('apps/docs/app/components/content/*.vue')

    expect(toViteRelativePath(generated, components)).toBe('../../docs/app/components/content/*.vue')
  })

  it('normalizes absolute Windows paths used by Tailwind sources', () => {
    expect(toVitePath('C:\\repo\\apps\\docs\\app\\components')).toBe('C:/repo/apps/docs/app/components')
  })

  it('resolves stylesheet imports from the generated stage directory', () => {
    const generated = resolve('apps/lab/.stages')
    const stylesheet = resolve('apps/docs/app/assets/css/main.css')
    const source = resolve('apps/docs/app')

    expect(renderStageSourceStylesheet(generated, [stylesheet], [source])).toBe([
      '@import "../../docs/app/assets/css/main.css";',
      `@source ${JSON.stringify(toVitePath(source))};`,
      '',
    ].join('\n'))
  })
})
