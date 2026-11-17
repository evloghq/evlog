/**
 * Prose words a reviewer reads before the proof. A draft quoted whole in an
 * outer fence, labelled `md`/`markdown` or unlabelled, is unwrapped first; then
 * inner fenced blocks and the ELI5 disclosure are left out.
 */
export function proseWords(reply: string): number {
  const text = reply.replace(/\r\n/g, '\n')
  // The wrapper is the reply's first fence and closes it; greedy, so it ends on the last fence line.
  const wrapped = text.match(/^(?:(?!`{3})[\s\S])*?(`{3,})(?:md|markdown)?\n([\s\S]*)\n\1\s*$/)
  const body = wrapped ? wrapped[2]! : text
  const prose = body
    .replace(/(`{3,})[\s\S]*?\1/g, '')
    .replace(/<details>[\s\S]*?<\/details>/g, '')
  return prose.split(/\s+/).filter(Boolean).length
}
