import { join, relative } from 'node:path'
import { appendProperty, appendToArray, applySplices, arrayMentions, findConfigObject, getProperty, hasProperty, readConfig } from '../../init/edit'
import type { ArrayNode, Splice } from '../../init/edit'
import type { WiringInput, WiringPlan } from '../../init/wiring'
import { configCandidates, firstExisting } from '../../init/wiring'

/** Registers the module only: it loads `evlog.config.ts`, where the settings live. */
export default function planNuxt(input: WiringInput): WiringPlan {
  const plan: WiringPlan = { actions: [], manual: [], already: [] }
  const configPath = firstExisting(input.root, configCandidates('nuxt.config'))

  if (!configPath) {
    const path = join(input.root, 'nuxt.config.ts')
    plan.actions.push({ path, relative: 'nuxt.config.ts', kind: 'create', contents: `export default defineNuxtConfig({\n  modules: ['evlog/nuxt'],\n})\n` })
    return plan
  }

  const relativePath = relative(input.root, configPath)
  const config = readConfig(configPath)
  const object = config ? findConfigObject(config.program) : null

  if (!config || !object) {
    plan.manual.push({
      title: 'Register the Nuxt module',
      file: relativePath,
      snippet: `modules: ['evlog/nuxt'],`,
      reason: config ? 'the config does not export a plain object literal' : 'the config could not be parsed',
    })
    return plan
  }

  const splices: Splice[] = []
  const modules = getProperty(object, 'modules')

  if (modules?.type === 'ArrayExpression') {
    if (arrayMentions(config.source, modules as ArrayNode, 'evlog/nuxt')) plan.already.push(`${relativePath} already registers evlog/nuxt`)
    else splices.push(appendToArray(config.source, modules as ArrayNode, `'evlog/nuxt'`))
  } else if (modules) {
    plan.manual.push({
      title: 'Register the Nuxt module',
      file: relativePath,
      snippet: `'evlog/nuxt'`,
      reason: '`modules` is computed rather than an array literal',
    })
  } else {
    splices.push(appendProperty(config.source, object, `modules: ['evlog/nuxt']`))
  }

  if (hasProperty(object, 'evlog')) {
    plan.already.push(`${relativePath} already has an evlog block, and what it sets overrides evlog.config.ts`)
  }

  if (splices.length > 0) {
    plan.actions.push({
      path: configPath,
      relative: relativePath,
      kind: 'patch',
      contents: applySplices(config.source, splices),
    })
  }

  return plan
}
