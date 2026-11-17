import { describe, expect, it } from 'vitest'
import { proseWords } from './prose-words'

describe('proseWords', () => {
  it('unwraps a draft quoted in an unlabelled fence instead of dropping it', () => {
    expect(proseWords('Here is the draft:\n\n```\nFixes the drain.\n\n```text\nerr\n```\n```')).toBe(3)
    expect(proseWords(`\`\`\`\n${'word '.repeat(151)}\n\`\`\``)).toBe(151)
  })

  it('unwraps a labelled fence with CRLF line endings', () => {
    expect(proseWords('````markdown\r\nOne two three.\r\n\r\n```text\r\nlog\r\n```\r\n````\r\n')).toBe(3)
  })

  it('counts prose around code blocks when the reply is not wrapped', () => {
    expect(proseWords('Intro words here.\n\n```text\nlog line\n```\n\nAfter.\n\n<details><summary>ELI5</summary>Hidden words.</details>')).toBe(4)
  })
})
