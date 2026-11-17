import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, relative } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { isFrameworkRuntimePath } from './stack-frames'

interface NextParsedFrame {
  file: string | null
  line1: number | null
  column1: number | null
  methodName: string | null
  arguments: string[]
}

type SourceMapConsumerInstance = {
  originalPositionFor: (pos: { line: number, column: number }) => {
    source: string | null
    line: number | null
    column: number | null
    name: string | null
  }
}

const require = createRequire(import.meta.url)

function formatMappedFrame(
  methodName: string | null,
  sourceURL: string | null,
  line1: number | null,
  column1: number | null,
): string {
  let sourceLocation = line1 !== null ? `:${line1}` : ''
  if (column1 !== null && sourceLocation !== '') {
    sourceLocation += `:${column1}`
  }

  let fileLocation: string
  if (sourceURL !== null && sourceURL.startsWith('file://') && URL.canParse(sourceURL)) {
    fileLocation = relative(process.cwd(), fileURLToPath(sourceURL))
  } else if (sourceURL !== null && sourceURL.startsWith('/')) {
    fileLocation = relative(process.cwd(), sourceURL)
  } else {
    fileLocation = sourceURL ?? 'unknown'
  }

  return methodName
    ? `    at ${methodName} (${fileLocation}${sourceLocation})`
    : `    at ${fileLocation}${sourceLocation}`
}

function shouldSkipMappedSource(source: string): boolean {
  const normalized = source.replace(/\\/g, '/')
  return normalized.includes('node_modules')
    || normalized.includes('/packages/evlog/')
    || isFrameworkRuntimePath(normalized)
}

function resolveFrameFile(frame: NextParsedFrame): string | null {
  if (!frame.file) return null
  if (frame.file.startsWith('file://')) {
    try {
      return fileURLToPath(frame.file)
    } catch {
      return frame.file
    }
  }
  if (isAbsolute(frame.file)) return frame.file
  return null
}

function getSourceMapConsumer(
  frameFile: string,
  cache: Map<string, SourceMapConsumerInstance | null>,
): SourceMapConsumerInstance | null {
  const cached = cache.get(frameFile)
  if (cached !== undefined) return cached

  const mapPath = `${frameFile}.map`
  if (!existsSync(mapPath)) {
    cache.set(frameFile, null)
    return null
  }

  try {
    const sourceMapModule = require('next/dist/compiled/source-map') as {
      SourceMapConsumer: new(payload: unknown, sourceMapURL: string) => SourceMapConsumerInstance
    }
    const payload = JSON.parse(readFileSync(mapPath, 'utf8')) as unknown
    const chunkUrl = pathToFileURL(frameFile).href
    const consumer = new sourceMapModule.SourceMapConsumer(payload, `${chunkUrl}.map`)
    cache.set(frameFile, consumer)
    return consumer
  } catch {
    cache.set(frameFile, null)
    return null
  }
}

function mapFrame(
  frame: NextParsedFrame,
  cache: Map<string, SourceMapConsumerInstance | null>,
): { frame: NextParsedFrame, skipped: boolean } {
  if (frame.file?.startsWith('node:')) {
    return { frame, skipped: true }
  }

  const frameFile = resolveFrameFile(frame)
  if (!frameFile || frame.line1 === null) {
    return { frame, skipped: false }
  }

  const consumer = getSourceMapConsumer(frameFile, cache)
  if (!consumer) {
    if (frameFile.includes('.next/')) {
      return { frame, skipped: true }
    }
    return { frame, skipped: false }
  }

  const sourcePosition = consumer.originalPositionFor({
    line: frame.line1,
    column: (frame.column1 ?? 1) - 1,
  })

  if (!sourcePosition.source || sourcePosition.line === null) {
    return { frame, skipped: frameFile.includes('.next/') }
  }

  if (shouldSkipMappedSource(sourcePosition.source)) {
    return { frame, skipped: true }
  }

  return {
    frame: {
      ...frame,
      file: sourcePosition.source,
      line1: sourcePosition.line,
      column1: sourcePosition.column === null ? null : sourcePosition.column + 1,
      methodName: sourcePosition.name ?? frame.methodName,
    },
    skipped: false,
  }
}

/**
 * Rewrite `error.stack` with Turbopack/Webpack source-mapped frames in Next.js dev.
 * Reads sibling `.map` files for `.next` chunks (same resolution as the dev overlay).
 */
export function enrichErrorStackFromNextDev(error: Error): void {
  if (process.env.NODE_ENV === 'production') return
  if (!error.stack) return

  try {
    const { parseStack } = require('next/dist/server/lib/parse-stack') as {
      parseStack: (stack: string, distDir?: string) => NextParsedFrame[]
    }

    const frames = parseStack(error.stack)
    if (frames.length === 0) return

    const cache = new Map<string, SourceMapConsumerInstance | null>()
    const mappedLines: string[] = []

    for (const frame of frames) {
      const { frame: mapped, skipped } = mapFrame(frame, cache)
      if (skipped) continue
      mappedLines.push(formatMappedFrame(mapped.methodName, mapped.file, mapped.line1, mapped.column1))
    }

    if (mappedLines.length === 0) return

    error.stack = `${error.name || 'Error'}: ${error.message}\n${mappedLines.join('\n')}`
  } catch {
    // Next internals unavailable — keep the original stack
  }
}
