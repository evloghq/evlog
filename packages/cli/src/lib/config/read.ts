import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Expression, ModuleExportName, Node, ObjectExpression, ObjectProperty, Program } from 'oxc-parser'
import { cliErrors } from '../errors'
import { parseSource } from '../map/parse'
import type { LineIndex } from '../map/parse'
import { isRelativeSpecifier, resolveModuleFile } from './modules'

/**
 * A value the config only has once it runs: a call, a function, a binding
 * imported from a package. Kept in place of the value so the rest of the
 * config can still be read, and rendered as the code that produces it.
 */
export class RuntimeValue {
  constructor(readonly code: string) {}

  toJSON(): { runtime: string } {
    return { runtime: this.code }
  }
}

/** One config object as written, before it is merged with the one it extends. */
export interface ConfigDocument {
  /** The file the object literal is written in. */
  file: string
  value: Record<string, unknown>
  /** Line of each property, by dotted path. */
  lines: Map<string, number>
}

export interface ReadConfigResult {
  config: ConfigDocument
  /** The config `config` extends, with the specifier it was imported from (`null` when it is defined in the same file). */
  parent: { specifier: string | null, document: ConfigDocument } | null
}

interface Module {
  file: string
  source: string
  program: Program
  lines: LineIndex
  /** Top-level variable initialisers, by name. */
  bindings: Map<string, Expression>
  /** Imported bindings, by local name; `imported` is `default`, an export name, or `*`. */
  imports: Map<string, { source: string, imported: string }>
}

interface Located<T> {
  module: Module
  node: T
}

/** Bounds how far a name is followed through bindings and re-exports, so a cycle ends. */
const MAX_HOPS = 8
const DEFINE_SOURCES = new Set(['evlog', 'evlog/toolkit'])
const WRAPPERS = new Set(['ParenthesizedExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion'])
const SNIPPET_LENGTH = 60

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
}

function strip(node: Expression): Expression {
  let current = node
  while (WRAPPERS.has(current.type)) current = (current as { expression: Expression }).expression
  return current
}

function exportName(node: ModuleExportName): string {
  return node.type === 'Literal' ? node.value : node.name
}

function propertyName(prop: ObjectProperty): string | null {
  const { key } = prop
  if (!prop.computed && key.type === 'Identifier') return key.name
  if (key.type === 'Literal' && (typeof key.value === 'string' || typeof key.value === 'number')) return String(key.value)
  return null
}

function indexModule(program: Program): Pick<Module, 'bindings' | 'imports'> {
  const bindings = new Map<string, Expression>()
  const imports = new Map<string, { source: string, imported: string }>()
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration') {
      if (statement.importKind === 'type') continue
      for (const specifier of statement.specifiers) {
        if (specifier.type === 'ImportSpecifier' && specifier.importKind === 'type') continue
        const imported = specifier.type === 'ImportDefaultSpecifier'
          ? 'default'
          : specifier.type === 'ImportNamespaceSpecifier' ? '*' : exportName(specifier.imported)
        imports.set(specifier.local.name, { source: statement.source.value, imported })
      }
      continue
    }
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type !== 'VariableDeclaration') continue
    for (const declarator of declaration.declarations) {
      if (declarator.id.type === 'Identifier' && declarator.init) bindings.set(declarator.id.name, declarator.init)
    }
  }
  return { bindings, imports }
}

class Reader {
  private readonly modules = new Map<string, Module>()

  constructor(private readonly label: (file: string) => string) {}

  module(file: string): Module {
    const cached = this.modules.get(file)
    if (cached) return cached
    const source = readFileSync(file, 'utf8')
    const parsed = parseSource(file, source)
    if (!parsed) throw cliErrors.CONFIG_NO_EXPORT({ file: this.label(file), name: 'default' })
    if (parsed.errors.length > 0) throw cliErrors.CONFIG_PARSE_FAILED({ file: this.label(file), reason: parsed.errors[0] ?? 'unknown error' })
    const module: Module = { file, source, program: parsed.program, lines: parsed.lines, ...indexModule(parsed.program) }
    this.modules.set(file, module)
    return module
  }

  snippet(module: Module, node: Node): string {
    const code = module.source.slice(node.start, node.end).replace(/\s+/g, ' ')
    return code.length > SNIPPET_LENGTH ? `${code.slice(0, SNIPPET_LENGTH - 1)}…` : code
  }

  /** What `file` exports as `name`, following re-exports. */
  exported(file: string, name: string, hops: number): Located<Expression> | null {
    if (hops > MAX_HOPS) return null
    const module = this.module(file)
    for (const statement of module.program.body) {
      if (statement.type === 'ExportDefaultDeclaration' && name === 'default') {
        const { declaration } = statement
        const isExpression = declaration.type !== 'FunctionDeclaration' && declaration.type !== 'ClassDeclaration'
          && declaration.type !== 'TSInterfaceDeclaration'
        return isExpression ? { module, node: declaration as Expression } : null
      }
      if (statement.type !== 'ExportNamedDeclaration') continue
      if (statement.declaration?.type === 'VariableDeclaration') {
        for (const declarator of statement.declaration.declarations) {
          if (declarator.id.type === 'Identifier' && declarator.id.name === name && declarator.init) return { module, node: declarator.init }
        }
      }
      for (const specifier of statement.specifiers) {
        if (exportName(specifier.exported) !== name) continue
        const local = exportName(specifier.local)
        if (!statement.source) return this.binding(module, local, hops + 1)
        const target = resolveModuleFile(statement.source.value, dirname(file))
        return target ? this.exported(target, local, hops + 1) : null
      }
    }
    return null
  }

  /**
   * What a top-level name refers to: a variable in the module, or an export of
   * a file it imports by path. Packages are not followed here, so a value
   * imported from one stays a {@link RuntimeValue}.
   */
  binding(module: Module, name: string, hops: number): Located<Expression> | null {
    if (hops > MAX_HOPS) return null
    const local = module.bindings.get(name)
    if (local) return { module, node: local }
    const imported = module.imports.get(name)
    if (!imported || imported.imported === '*' || !isRelativeSpecifier(imported.source)) return null
    const target = resolveModuleFile(imported.source, dirname(module.file))
    return target ? this.exported(target, imported.imported, hops + 1) : null
  }

  isDefineEvlog(module: Module, callee: Expression): boolean {
    if (callee.type !== 'Identifier') return false
    const imported = module.imports.get(callee.name)
    if (imported) return DEFINE_SOURCES.has(imported.source) && imported.imported === 'defineEvlog'
    return callee.name === 'defineEvlog'
  }

  /** The object literal an expression configures, through `defineEvlog(...)` and named bindings. */
  configObject(module: Module, node: Expression, hops: number): Located<ObjectExpression> | null {
    if (hops > MAX_HOPS) return null
    const expression = strip(node)
    if (expression.type === 'ObjectExpression') return { module, node: expression }
    if (expression.type === 'CallExpression' && this.isDefineEvlog(module, expression.callee)) {
      const [argument] = expression.arguments
      if (expression.arguments.length !== 1 || !argument || argument.type === 'SpreadElement') return null
      return this.configObject(module, argument, hops + 1)
    }
    if (expression.type === 'Identifier') {
      const target = this.binding(module, expression.name, hops + 1)
      return target ? this.configObject(target.module, target.node, hops + 1) : null
    }
    return null
  }

  evaluate({ module, node }: Located<Expression>, path: string, lines: Map<string, number> | undefined, hops: number): unknown {
    const expression = strip(node)
    switch (expression.type) {
      case 'Literal': {
        if ('regex' in expression && expression.regex) return new RegExp(expression.regex.pattern, expression.regex.flags)
        const { value } = expression
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
        break
      }
      case 'TemplateLiteral': {
        const [quasi] = expression.quasis
        if (expression.expressions.length === 0 && quasi) return quasi.value.cooked ?? quasi.value.raw
        break
      }
      case 'UnaryExpression': {
        const operand = this.evaluate({ module, node: expression.argument }, path, undefined, hops)
        if (expression.operator === '-' && typeof operand === 'number') return -operand
        break
      }
      case 'ArrayExpression': {
        const items: unknown[] = []
        for (const element of expression.elements) {
          const item = !element
            ? undefined
            : element.type === 'SpreadElement'
              ? this.evaluate({ module, node: element.argument }, path, undefined, hops)
              : this.evaluate({ module, node: element }, path, undefined, hops)
          /* An array is static only when every element is: a list half read
             at runtime cannot be merged or checked entry by entry. */
          if (item instanceof RuntimeValue || (element?.type === 'SpreadElement' && !Array.isArray(item))) {
            return new RuntimeValue(this.snippet(module, expression))
          }
          if (element?.type === 'SpreadElement') items.push(...(item as unknown[]))
          else items.push(item)
        }
        return items
      }
      case 'ObjectExpression':
        return this.object({ module, node: expression }, path, lines, hops)
      case 'Identifier': {
        if (expression.name === 'undefined') return undefined
        const target = this.binding(module, expression.name, hops + 1)
        /* Lines are recorded against the file being read, so an object that
           lives in another file contributes its values but not its lines. */
        if (target) return this.evaluate(target, path, target.module === module ? lines : undefined, hops + 1)
        break
      }
    }
    return new RuntimeValue(this.snippet(module, expression))
  }

  object({ module, node }: Located<ObjectExpression>, prefix: string, lines: Map<string, number> | undefined, hops: number): Record<string, unknown> | RuntimeValue {
    const out: Record<string, unknown> = {}
    for (const prop of node.properties) {
      const line = module.lines.lineAt(prop.start)
      if (prop.type === 'SpreadElement') {
        const spread = this.evaluate({ module, node: prop.argument }, prefix, undefined, hops)
        if (!isPlainObject(spread)) return new RuntimeValue(this.snippet(module, node))
        Object.assign(out, spread)
        for (const key of Object.keys(spread)) lines?.set(prefix ? `${prefix}.${key}` : key, line)
        continue
      }
      const key = propertyName(prop)
      /* A computed key could be any key, so nothing about the object is known. */
      if (key === null) return new RuntimeValue(this.snippet(module, node))
      const path = prefix ? `${prefix}.${key}` : key
      lines?.set(path, line)
      out[key] = prop.method || prop.kind !== 'init'
        ? new RuntimeValue(this.snippet(module, prop))
        : this.evaluate({ module, node: prop.value }, path, lines, hops)
    }
    return out
  }

  /** Read a config object; `extends` is returned apart, as written. */
  document(located: Located<ObjectExpression>): { document: ConfigDocument, extendsNode: { node: Expression, line: number } | null } {
    const { module, node } = located
    let extendsNode: { node: Expression, line: number } | null = null
    const properties = node.properties.filter((prop) => {
      if (prop.type !== 'Property' || propertyName(prop) !== 'extends') return true
      extendsNode = { node: prop.value, line: module.lines.lineAt(prop.start) }
      return false
    })
    const lines = new Map<string, number>()
    const value = this.object({ module, node: { ...node, properties } }, '', lines, 0)
    if (value instanceof RuntimeValue) {
      throw cliErrors.CONFIG_NOT_STATIC({ key: 'The config', at: `${this.label(module.file)}:${module.lines.lineAt(node.start)}` })
    }
    return { document: { file: module.file, value, lines }, extendsNode }
  }

  read(file: string, name: string): ReturnType<Reader['document']> {
    const exported = this.exported(file, name, 0)
    const object = exported && this.configObject(exported.module, exported.node, 0)
    if (!object) throw cliErrors.CONFIG_NO_EXPORT({ file: this.label(file), name })
    return this.document(object)
  }

  /** The config an `extends` value refers to: an import, a config in the same file, or an inline object. */
  parent(module: Module, extendsNode: { node: Expression, line: number }): { specifier: string | null } & ReturnType<Reader['document']> {
    const at = `${this.label(module.file)}:${extendsNode.line}`
    const node = strip(extendsNode.node)
    const imported = node.type === 'Identifier' ? module.imports.get(node.name) : undefined
    if (imported && imported.imported !== '*') {
      const target = resolveModuleFile(imported.source, dirname(module.file))
      if (!target) throw cliErrors.CONFIG_EXTENDS_NOT_FOUND({ specifier: imported.source, at })
      return { specifier: imported.source, ...this.read(target, imported.imported) }
    }
    const object = this.configObject(module, node, 0)
    if (!object) throw cliErrors.CONFIG_NOT_STATIC({ key: 'extends', at })
    return { specifier: null, ...this.document(object) }
  }
}

/**
 * Read `evlog.config` and the config it extends without running either.
 *
 * Literals become data; anything else becomes a {@link RuntimeValue}, so
 * callers can tell what the file says from what it computes. Paths in errors
 * go through `label`.
 *
 * @throws a `cli.CONFIG_*` error when the file cannot be read this way, or
 * extends a config that itself extends another.
 */
export function readConfig(file: string, label: (file: string) => string): ReadConfigResult {
  const reader = new Reader(label)
  const { document, extendsNode } = reader.read(file, 'default')
  if (!extendsNode) return { config: document, parent: null }

  const parent = reader.parent(reader.module(document.file), extendsNode)
  if (parent.extendsNode) {
    throw cliErrors.CONFIG_EXTENDS_DEPTH({
      parent: parent.specifier ?? label(parent.document.file),
      at: `${label(document.file)}:${(extendsNode as { line: number }).line}`,
    })
  }
  return { config: document, parent: { specifier: parent.specifier, document: parent.document } }
}
