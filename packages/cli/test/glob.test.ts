import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { glob } from '../src/lib/glob'
import { relativeFromRoot } from '../src/lib/map/utils'

describe('glob', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'evlog-cli-glob-'))
    const files = [
      'src/index.ts',
      'src/types.d.ts',
      'src/build/handler.ts',
      'src/dist/handler.ts',
      'src/coverage/handler.ts',
      'src/node_modules/pkg/index.ts',
      'dist/index.ts',
      'build/index.ts',
      'coverage/index.ts',
      'node_modules/pkg/index.ts',
      '.nuxt/index.ts',
    ]
    for (const path of files) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), '', 'utf8')
    }
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('skips build output at the project root only, and dependencies at any depth', () => {
    expect(glob('**/*.ts', root).map(file => relativeFromRoot(root, file))).toEqual([
      'src/build/handler.ts',
      'src/coverage/handler.ts',
      'src/dist/handler.ts',
      'src/index.ts',
    ])
  })
})
