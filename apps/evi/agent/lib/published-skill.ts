import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { SkillDefinition } from 'eve/skills'
import { parse } from 'yaml'

/** Skills the repository publishes for other agents live in `<repo>/skills/`; eve runs from `apps/evi`. */
const SKILLS_DIR = join(process.cwd(), '..', '..', 'skills')

interface Frontmatter {
  readonly description: string
  readonly license?: string
  readonly metadata?: Record<string, string>
}

/** Reads a published skill package into the shape `defineSkill` takes, so Evi carries the same file the docs site serves. */
export function publishedSkill(name: string): SkillDefinition {
  const dir = join(SKILLS_DIR, name)
  const raw = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  const end = raw.indexOf('\n---', 4)
  const { description, license, metadata } = parse(raw.slice(4, end)) as Frontmatter
  const files = Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== 'SKILL.md')
      .map((entry) => {
        const path = join(entry.parentPath, entry.name)
        return [relative(dir, path), readFileSync(path, 'utf8')]
      }),
  )
  return { description, license, metadata, markdown: raw.slice(end + 4).trimStart(), files }
}
