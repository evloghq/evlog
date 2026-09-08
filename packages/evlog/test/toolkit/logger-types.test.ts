import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('typechecks logger source and generic accessors without importing Nitro first', () => {
  const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
  const fixture = fileURLToPath(new URL('../fixtures/logger-types.ts', import.meta.url))
  const config = ts.readConfigFile(`${packageRoot}/tsconfig.json`, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot)
  const program = ts.createProgram([fixture], { ...parsed.options, noEmit: true })
  const diagnostics = ts.getPreEmitDiagnostics(program)

  expect(ts.formatDiagnostics(diagnostics, {
    getCurrentDirectory: () => packageRoot,
    getCanonicalFileName: file => file,
    getNewLine: () => '\n',
  })).toBe('')
})
