import { join, relative } from 'node:path'
import { addImport, appendProperty, appendToArray, applySplices, arrayMentions, findConfigObject, getProperty, hasImportFrom, hasProperty, readConfig } from '../../init/edit'
import type { ArrayNode, ObjectNode, Splice } from '../../init/edit'
import type { WiringInput, WiringPlan } from '../../init/wiring'
import { configCandidates, firstExisting } from '../../init/wiring'

function nitroModuleSpecifier(major: 2 | 3): string {
  return major === 3 ? 'evlog/nitro/v3' : 'evlog/nitro'
}

function nitroConfigTemplate(input: WiringInput): string {
  const asyncContext = input.framework === 'tanstack-start'
    ? '  experimental: {\n    asyncContext: true,\n  },\n'
    : ''

  if (input.nitroMajor === 3) {
    return `import { defineConfig } from 'nitro'
import evlog from 'evlog/nitro/v3'

export default defineConfig({
${asyncContext}  modules: [evlog()],
})
`
  }

  return `import { defineNitroConfig } from 'nitropack/config'
import evlog from 'evlog/nitro'

export default defineNitroConfig({
  modules: [evlog()],
})
`
}

/** Registers the module only: it loads `evlog.config.ts`, where the settings live. */
export default function planNitro(input: WiringInput): WiringPlan {
  const plan: WiringPlan = { actions: [], manual: [], already: [] }
  const specifier = nitroModuleSpecifier(input.nitroMajor)
  const configPath = firstExisting(input.root, configCandidates('nitro.config'))

  if (!configPath) {
    const path = join(input.root, 'nitro.config.ts')
    plan.actions.push({ path, relative: 'nitro.config.ts', kind: 'create', contents: nitroConfigTemplate(input) })
    return plan
  }

  const relativePath = relative(input.root, configPath)
  const config = readConfig(configPath)
  const object = config ? findConfigObject(config.program) : null

  if (!config || !object) {
    plan.manual.push({
      title: 'Register the Nitro module',
      file: relativePath,
      snippet: `import evlog from '${specifier}'\n\n// inside the config:\nmodules: [evlog()],`,
      reason: config ? 'the config does not export a plain object literal' : 'the config could not be parsed',
    })
    return plan
  }

  const splices: Splice[] = []
  const modules = getProperty(object, 'modules')
  let needsImport = false

  if (modules?.type === 'ArrayExpression') {
    if (arrayMentions(config.source, modules as ArrayNode, 'evlog')) {
      plan.already.push(`${relativePath} already registers the evlog module, and the options passed to it override evlog.config.ts`)
    } else {
      splices.push(appendToArray(config.source, modules as ArrayNode, 'evlog()'))
      needsImport = true
    }
  } else if (modules) {
    plan.manual.push({
      title: 'Register the Nitro module',
      file: relativePath,
      snippet: 'evlog()',
      reason: '`modules` is computed rather than an array literal',
    })
  } else {
    splices.push(appendProperty(config.source, object, 'modules: [evlog()]'))
    needsImport = true
  }

  if (needsImport && !hasImportFrom(config.program, specifier)) {
    splices.push(addImport(config.source, config.program, `import evlog from '${specifier}'`))
  }

  if (input.framework === 'tanstack-start') {
    /* `useRequest()` is how TanStack Start route handlers reach the logger, and
       it returns nothing without async context: the module without this flag
       logs no business context. */
    const experimental = getProperty(object, 'experimental')
    if (!experimental) {
      splices.push(appendProperty(config.source, object, `experimental: {\n    asyncContext: true,\n  }`))
    } else if (experimental.type === 'ObjectExpression' && !hasProperty(experimental as ObjectNode, 'asyncContext')) {
      splices.push(appendProperty(config.source, experimental as ObjectNode, 'asyncContext: true'))
    }
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
