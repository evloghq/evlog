import { registerPrettyErrorSnippetReader } from './stack-frames'

/**
 * Register the disk-backed pretty-error snippet reader when Node built-ins are available.
 *
 * Uses a dynamic import so Edge and non-Node bundles never parse `pretty-error-snippet.node`.
 *
 * @internal
 */
export async function registerDiskPrettyErrorSnippetReader(): Promise<void> {
  try {
    const { readCodeSnippetFromDisk } = await import('./pretty-error-snippet.node.js')
    registerPrettyErrorSnippetReader(readCodeSnippetFromDisk)
  } catch {
    registerPrettyErrorSnippetReader(null)
  }
}
