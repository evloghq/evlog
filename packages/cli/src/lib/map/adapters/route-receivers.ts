import type { Node } from 'oxc-parser'
import type { ParseResult } from '../parse'
import { walkAst } from '../parse'

interface ImportNames {
  defaultName: string | null
  named: ReadonlyMap<string, string>
}

export interface ExpressReceiverContext {
  receivers: Set<string>
  imports: ImportNames
}

export interface FastifyReceiverContext {
  receivers: Set<string>
  imports: ImportNames
}

export interface ElysiaReceiverContext {
  receivers: Set<string>
  imports: ImportNames
}

function identifierName(node: Node | undefined): string | null {
  return node?.type === 'Identifier' ? (node as { name: string }).name : null
}

function stringLiteral(node: Node | undefined): string | null {
  if (!node) return null
  if (node.type === 'Literal' && typeof (node as { value: unknown }).value === 'string') {
    return (node as { value: string }).value
  }
  return null
}

/** Whether `node` is `require('module')`. */
function isRequireOf(node: Node | undefined, module: string): boolean {
  if (!node || node.type !== 'CallExpression') return false
  const call = node as { callee: Node, arguments: Node[] }
  if (identifierName(call.callee) !== 'require') return false
  return stringLiteral(call.arguments[0]) === module
}

/** Record named bindings from `const { Router } = …` / `const { Router: R } = …`. */
function collectNamedBindings(id: Node, named: Map<string, string>): void {
  if (id.type !== 'ObjectPattern') return
  const { properties } = id as { properties: Node[] }
  for (const prop of properties) {
    if (prop.type !== 'Property') continue
    const { key, value } = prop as { key: Node, value: Node }
    const imported = identifierName(key)
    const local = identifierName(value)
    if (imported && local) named.set(imported, local)
  }
}

/**
 * Local bindings for a module's default and named imports.
 *
 * Covers ESM (`import express from 'express'`, `import { Router } from 'express'`)
 * and CommonJS (`const express = require('express')`, `const { Router } = require('express')`).
 */
function importNames(parsed: ParseResult, module: string): ImportNames {
  const named = new Map<string, string>()
  let defaultName: string | null = null

  walkAst(parsed.program, (node) => {
    if (node.type === 'ImportDeclaration') {
      const declaration = node as {
        source: { value: string }
        specifiers: Array<{
          type: string
          imported?: { name?: string }
          local?: { name: string }
        }>
      }
      if (declaration.source.value !== module) return
      for (const specifier of declaration.specifiers) {
        if (!specifier.local) continue
        if (specifier.type === 'ImportDefaultSpecifier') {
          defaultName = specifier.local.name
        } else if (specifier.type === 'ImportSpecifier' && specifier.imported?.name) {
          named.set(specifier.imported.name, specifier.local.name)
        }
      }
      return
    }

    if (node.type !== 'VariableDeclarator') return
    const declarator = node as { id: Node, init?: Node }
    const { id, init } = declarator
    if (!isRequireOf(init, module)) return

    const binding = identifierName(id)
    if (binding) {
      defaultName = binding
      return
    }
    collectNamedBindings(id, named)
  })

  return { defaultName, named }
}

/** Whether `callee` is `express()` or `Router()`. */
function isExpressFactory(callee: Node, imports: ImportNames): boolean {
  const name = identifierName(callee)
  if (name) {
    return name === imports.defaultName || name === imports.named.get('Router') || false
  }
  if (callee.type !== 'MemberExpression') return false
  const member = callee as { object: Node, property: Node, computed?: boolean }
  if (member.computed || member.property.type !== 'Identifier') return false
  if (member.property.name !== 'Router') return false
  return identifierName(member.object) === imports.defaultName
}

/** Whether `callee` is `Fastify()`. */
function isFastifyFactory(callee: Node, imports: ImportNames): boolean {
  return identifierName(callee) === imports.defaultName
}

/** Whether `callee` is `new Elysia()`. */
function isElysiaConstructor(callee: Node, imports: ImportNames): boolean {
  const elysia = imports.named.get('Elysia')
  return elysia !== undefined && identifierName(callee) === elysia
}

function collectFactoryBindings(
  parsed: ParseResult,
  isFactory: (callee: Node, imports: ImportNames) => boolean,
  imports: ImportNames,
  fromNew = false,
): Set<string> {
  const receivers = new Set<string>()

  walkAst(parsed.program, (node) => {
    if (node.type !== 'VariableDeclarator') return
    const declarator = node as { id: Node, init?: Node }
    const { id, init } = declarator
    const binding = identifierName(id)
    if (!binding || !init) return
    if (fromNew) {
      if (init.type !== 'NewExpression') return
      if (isFactory((init as { callee: Node }).callee, imports)) receivers.add(binding)
      return
    }
    if (init.type === 'CallExpression' && isFactory((init as { callee: Node }).callee, imports)) {
      receivers.add(binding)
    }
  })

  return receivers
}

/** Express app and Router bindings for one file. */
export function expressReceiverContext(parsed: ParseResult): ExpressReceiverContext {
  const imports = importNames(parsed, 'express')
  return {
    imports,
    receivers: collectFactoryBindings(parsed, isExpressFactory, imports),
  }
}

/** Fastify instance bindings for one file. */
export function fastifyReceiverContext(parsed: ParseResult): FastifyReceiverContext {
  const imports = importNames(parsed, 'fastify')
  return {
    imports,
    receivers: collectFactoryBindings(parsed, isFastifyFactory, imports),
  }
}

/** Elysia instance bindings for one file. */
export function elysiaReceiverContext(parsed: ParseResult): ElysiaReceiverContext {
  const imports = importNames(parsed, 'elysia')
  return {
    imports,
    receivers: collectFactoryBindings(parsed, isElysiaConstructor, imports, true),
  }
}

/**
 * HTTP methods Express chains after `app.route('/path')`.
 *
 * Kept local so this module does not import the adapter's ROUTE_METHODS map.
 */
const EXPRESS_ROUTE_CHAIN = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'all',
])

/**
 * Whether a member call targets an Express app, Router, or route builder.
 *
 * Accepts `app` / `router` bindings, factory calls (`express()`, `Router()`),
 * and `app.route('/path')` / `router.route('/path').get(…)` chains so chained
 * handlers can be mapped.
 */
export function isExpressRouteReceiver(node: Node, ctx: ExpressReceiverContext): boolean {
  if (node.type === 'Identifier') return ctx.receivers.has(node.name)
  if (node.type !== 'CallExpression') return false

  const { callee } = node as { callee: Node }
  if (isExpressFactory(callee, ctx.imports)) return true
  if (callee.type !== 'MemberExpression') return false

  const member = callee as { object: Node, property: Node, computed?: boolean }
  if (member.computed || member.property.type !== 'Identifier') return false
  if (member.property.name === 'route' || EXPRESS_ROUTE_CHAIN.has(member.property.name)) {
    return isExpressRouteReceiver(member.object, ctx)
  }
  return false
}

/** Whether a member call targets a Fastify instance. */
export function isFastifyRouteReceiver(node: Node, ctx: FastifyReceiverContext): boolean {
  if (node.type === 'Identifier') return ctx.receivers.has(node.name)
  if (node.type === 'CallExpression') {
    return isFastifyFactory((node as { callee: Node }).callee, ctx.imports)
  }
  return false
}

/** Whether a member call targets an Elysia instance or a chained registration. */
export function isElysiaRouteReceiver(node: Node, ctx: ElysiaReceiverContext): boolean {
  if (node.type === 'Identifier') return ctx.receivers.has(node.name)
  if (node.type === 'NewExpression') {
    return isElysiaConstructor((node as { callee: Node }).callee, ctx.imports)
  }
  if (node.type === 'CallExpression') {
    const { callee } = node as { callee: Node }
    if (callee.type !== 'MemberExpression') return false
    return isElysiaRouteReceiver((callee as { object: Node }).object, ctx)
  }
  return false
}
