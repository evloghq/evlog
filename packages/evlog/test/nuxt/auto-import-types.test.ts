import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fixtureDir = resolve(packageRoot, 'test/fixtures/nuxt-ts')

function typeOfUseLogger(declarationPaths: string[]) {
  const configPath = resolve(fixtureDir, 'tsconfig.json')
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    fixtureDir,
  )
  const handlerPath = resolve(fixtureDir, 'server/handler.ts')
  const options = { ...parsed.options, noEmit: true }
  const program = ts.createProgram({
    rootNames: [handlerPath, ...declarationPaths],
    options,
  })
  const sourceFile = program.getSourceFile(handlerPath)
  const checker = program.getTypeChecker()

  let useLoggerType = 'missing'

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'useLogger'
    ) {
      useLoggerType = checker.typeToString(checker.getTypeAtLocation(node.expression))
    }
    ts.forEachChild(node, visit)
  }

  if (sourceFile) {
    visit(sourceFile)
  }

  return useLoggerType
}

describe('nuxt auto-import type declarations', () => {
  it('types useLogger through the evlog package specifier', () => {
    const useLoggerType = typeOfUseLogger([resolve(fixtureDir, 'evlog-server.d.ts')])

    expect(useLoggerType).not.toBe('any')
    expect(useLoggerType).toContain('NitroRequestLogger')
    expect(useLoggerType).toContain('ServerEvent')
  })

  it('falls back to any when only Nitro extensionless dist paths are declared', () => {
    const useLoggerType = typeOfUseLogger([resolve(fixtureDir, 'nitro-imports-broken.d.ts')])

    expect(useLoggerType).toBe('any')
  })
})
