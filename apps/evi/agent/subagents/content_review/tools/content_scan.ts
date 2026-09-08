import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { parseLintReport, repoPathError, scanCommand } from '../../../lib/content/scan'
import { runOutput } from '../../../lib/workspace'

/** A passage larger than this is a file, and a file has a path. */
const MAX_PASSAGE_CHARS = 200_000

/**
 * Read-only, and the reviewer's own: a reviewer that can only see a fixed
 * list reviews only that list. This is what lets it scan a passage it is
 * unsure about, a page the pass did not pick, or the source a claim points at.
 */
export default defineTool({
  description: 'Scan prose for the deterministic half of a content review. Pass `path` (a file in the checkout), `text` (a passage), or `url` (a page outside the repository, fetched and reduced to its main content). '
    + 'Returns the score, the metrics, and candidate findings with rule ids, lines, and verbatim excerpts, plus `modelChecks`: the questions no threshold reached on this page, which you answer by reading. '
    + 'Findings are candidates, never verdicts. A `url` scan drops every evlog-specific check, because someone else\'s entry points, links, and vocabulary are theirs.',
  inputSchema: z.object({
    path: z.string().optional().describe('Repo-relative path of a file in the checkout. Mutually exclusive with text and url.'),
    text: z.string().optional().describe('A passage of markdown to scan. Mutually exclusive with path and url.'),
    url: z.string().url().startsWith('http').optional().describe('An http or https page to fetch, extract, and scan. Mutually exclusive with path and text.'),
    as: z.enum(['docs', 'reference', 'landing', 'blog', 'readme', 'skill', 'agents']).optional()
      .describe('Which surface\'s thresholds to judge text or url against. Ignored for path, which takes its surface from where it lives. Default docs.'),
  }),
  async execute(input, toolCtx) {
    const given = [input.path, input.text, input.url].filter(value => value !== undefined)
    if (given.length !== 1) {
      return { success: false as const, error: 'Pass exactly one of path, text, or url.' }
    }

    if (input.path !== undefined) {
      const problem = repoPathError(input.path)
      if (problem !== null) return { success: false as const, error: problem }
    }

    if (input.text !== undefined && input.text.length > MAX_PASSAGE_CHARS) {
      return { success: false as const, error: `Passage is ${input.text.length} characters; scan a path instead above ${MAX_PASSAGE_CHARS}.` }
    }

    const sandbox = await toolCtx.getSandbox()
    const { command, passage } = scanCommand(input)
    if (passage !== undefined) await sandbox.writeTextFile(passage)
    const result = await sandbox.run({ command })

    if (result.exitCode !== 0) {
      return { success: false as const, error: `content-lint exited ${result.exitCode}: ${runOutput(result)}` }
    }

    const page = parseLintReport(result.stdout)?.pages.at(0)
    if (page === undefined) {
      return { success: false as const, error: 'content-lint returned no page.' }
    }

    return { success: true as const, page }
  },
})
