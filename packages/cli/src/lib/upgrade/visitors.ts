import type { Node } from 'oxc-parser'
import type { CodemodVisitor } from './types'

type Listener = (node: Node, parent: Node | null) => void

/** One visitor that calls each of `visitors` in order, for every node type any of them listens to. */
export function mergeVisitors(visitors: readonly CodemodVisitor[]): CodemodVisitor {
  const listeners = new Map<string, Listener[]>()
  for (const visitor of visitors) {
    for (const [type, listener] of Object.entries(visitor)) {
      if (type === 'onEnd' || !listener) continue
      listeners.set(type, [...(listeners.get(type) ?? []), listener as Listener])
    }
  }
  const merged: Record<string, Listener | (() => void)> = {}
  for (const [type, forType] of listeners) {
    merged[type] = (node: Node, parent: Node | null) => {
      for (const listener of forType) listener(node, parent)
    }
  }
  merged.onEnd = () => {
    for (const visitor of visitors) visitor.onEnd?.()
  }
  return merged as CodemodVisitor
}

/**
 * Listeners that add every name the file declares outside its imports
 * (variables, parameters, functions, classes, catch bindings, types) to `into`.
 * A codemod checks it before renaming an import, so a rename never captures
 * or collides with a local of the same name.
 */
export function bindingCollector(into: Set<string>): CodemodVisitor {
  const collect = (pattern: Node | null | undefined): void => {
    if (!pattern) return
    switch (pattern.type) {
      case 'Identifier':
        into.add(pattern.name)
        break
      case 'ObjectPattern':
        for (const property of pattern.properties) collect(property.type === 'RestElement' ? property.argument : property.value)
        break
      case 'ArrayPattern':
        for (const element of pattern.elements) collect(element)
        break
      case 'RestElement':
        collect(pattern.argument)
        break
      case 'AssignmentPattern':
        collect(pattern.left)
        break
      case 'TSParameterProperty':
        collect(pattern.parameter)
        break
    }
  }
  const fn = (node: { id?: Node | null, params: readonly Node[] }) => {
    collect(node.id)
    for (const param of node.params) collect(param)
  }
  return {
    VariableDeclarator: node => collect(node.id),
    FunctionDeclaration: fn,
    FunctionExpression: fn,
    ArrowFunctionExpression: fn,
    ClassDeclaration: node => collect(node.id),
    ClassExpression: node => collect(node.id),
    CatchClause: node => collect(node.param),
    TSTypeAliasDeclaration: node => collect(node.id),
    TSInterfaceDeclaration: node => collect(node.id),
    TSEnumDeclaration: node => collect(node.id),
  }
}
