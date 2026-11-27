import { readFile } from 'node:fs/promises'
import { join, normalize, relative, resolve } from 'pathe'
import { withHttps } from 'ufo'

export interface ContentDirInput {
  rootDir: string
  /** Git repository root containing `rootDir`, if one could be found. */
  gitRoot?: string
  /** `docs.contentDir`, or `NUXT_DOCS_CONTENT_DIR`. */
  explicit?: string
}

export interface ContentDirResult {
  /** Absolute path to the content directory (the dev filesystem source). */
  contentPath: string
  /** Content directory relative to the repository root (GitHub source, edit links). */
  contentDir: string
  source: 'explicit' | 'git' | 'assumed'
}

/**
 * Locate the content directory, both absolutely and relative to the repo root.
 *
 * The relative form is load-bearing: the GitHub source path and "Edit this page" links
 * derive from it, and both break silently (dev reads the absolute path) if the repo root can't
 * be found. Order: `explicit`, `gitRoot`, else assume the app *is* the repo root — right for a single-app repo,
 * wrong for `docs/`, undetectable from the filesystem, hence the `'assumed'` source for the caller to warn on.
 */
export function resolveContentDir({ rootDir, gitRoot, explicit }: ContentDirInput): ContentDirResult {
  const contentPath = join(rootDir, 'content')

  if (explicit) {
    return { contentPath, contentDir: normalize(explicit).replace(/^\/+|\/+$/g, ''), source: 'explicit' }
  }

  if (gitRoot) {
    return { contentPath, contentDir: relative(gitRoot, contentPath) || 'content', source: 'git' }
  }

  return { contentPath, contentDir: 'content', source: 'assumed' }
}

/** Infer the public site URL from the deployment platform env. */
export function inferSiteURL(): string | undefined {
  // https://github.com/unjs/std-env/issues/59
  const url =
    process.env.NUXT_PUBLIC_SITE_URL ||
    process.env.NUXT_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_BRANCH_URL ||
    process.env.VERCEL_URL ||
    process.env.URL || // Netlify
    process.env.CI_PAGES_URL || // GitLab Pages
    process.env.CF_PAGES_URL // Cloudflare Pages

  return url ? withHttps(url) : undefined
}

export async function getPackageJsonMetadata(
  dir: string
): Promise<{ name?: string; description?: string; version?: string }> {
  try {
    const parsed = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf-8'))
    return { name: parsed.name, description: parsed.description, version: parsed.version }
  } catch {
    return {}
  }
}
