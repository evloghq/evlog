import { join, relative } from 'node:path'
import { appendProperty, appendToArray, applySplices, arrayMentions, findConfigObject, getProperty, hasProperty, readConfig } from '../../init/edit'
import type { ArrayNode, ObjectNode, Splice } from '../../init/edit'
import type { WiringInput, WiringPlan } from '../../init/wiring'
import { configCandidates, firstExisting, samplingProperty, withNitroPlugins } from '../../init/wiring'

function nuxtConfigTemplate(input: WiringInput): string {
  const sampling = samplingProperty(input)
  return `export default defineNuxtConfig({
  modules: ['evlog/nuxt'],
  evlog: {
    env: { service: '${input.service}' },${sampling ? `\n    ${sampling},` : ''}
  },
})
`
}

export default function planNuxt(input: WiringInput): WiringPlan {
  const plan: WiringPlan = { actions: [], manual: [], already: [] }
  const configPath = firstExisting(input.root, configCandidates('nuxt.config'))

  if (!configPath) {
    const path = join(input.root, 'nuxt.config.ts')
    plan.actions.push({ path, relative: 'nuxt.config.ts', kind: 'create', contents: nuxtConfigTemplate(input) })
    return withNitroPlugins(plan, input)
  }

  const relativePath = relative(input.root, configPath)
  const config = readConfig(configPath)
  const object = config ? findConfigObject(config.program) : null

  if (!config || !object) {
    plan.manual.push({
      title: 'Register the Nuxt module',
      file: relativePath,
      snippet: `modules: ['evlog/nuxt'],\nevlog: {\n  env: { service: '${input.service}' },\n},`,
      reason: config ? 'the config does not export a plain object literal' : 'the config could not be parsed',
    })
    return withNitroPlugins(plan, input)
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
    plan.already.push(`${relativePath} already has an evlog block`)
    const sampling = samplingProperty(input)
    const block = getProperty(object, 'evlog')
    if (sampling && block?.type === 'ObjectExpression') {
      if (hasProperty(block as ObjectNode, 'sampling')) {
        plan.manual.push({
          title: 'Reconcile the sampling rates',
          file: relativePath,
          snippet: `${sampling},`,
          reason: 'the evlog block already sets sampling — replacing rates you chose is not init\'s call',
        })
      } else {
        splices.push(appendProperty(config.source, block as ObjectNode, sampling))
      }
    } else if (sampling) {
      plan.manual.push({
        title: 'Add sampling to the evlog block',
        file: relativePath,
        snippet: `${sampling},`,
        reason: 'the evlog block is not a plain object literal',
      })
    }
  } else {
    const sampling = samplingProperty(input)
    splices.push(appendProperty(
      config.source,
      object,
      `evlog: {\n    env: { service: '${input.service}' },${sampling ? `\n    ${sampling},` : ''}\n  }`,
    ))
  }

  if (splices.length > 0) {
    plan.actions.push({
      path: configPath,
      relative: relativePath,
      kind: 'patch',
      contents: applySplices(config.source, splices),
    })
  }

  return withNitroPlugins(plan, input)
}
