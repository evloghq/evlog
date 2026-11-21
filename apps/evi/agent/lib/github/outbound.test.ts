import { describe, expect, it } from 'vitest'
import { outboundDenial, PR_PROSE_WORD_LIMIT } from './outbound'

const ELI5 = '<details>\n<summary>ELI5</summary>\n\nPlain words.\n\n</details>'
const PROOF = '```\nsentry.test.ts 49 passed (49)\n```'

function pullRequest(body: string, title = 'fix(sentry): send user.id on logs') {
  return { title, body }
}

describe('outboundDenial', () => {
  it('refuses an em dash in prose but not in code or an en dash', () => {
    expect(outboundDenial('addIssueComment', { body: 'Fixed in main — thanks.' })).toContain('em dash')
    expect(outboundDenial('addIssueComment', { body: 'The title is `evlog — wide events`.\n\n```\nevlog — wide events\n```' })).toBeNull()
    expect(outboundDenial('addIssueComment', { body: 'Versions 2.1–2.3 are affected.' })).toBeNull()
  })

  it('checks the title as well as the body', () => {
    expect(outboundDenial('createIssue', { title: 'Drain drops events — on retry', body: 'Repro below.' })).toContain('title')
  })

  it('refuses the Linear ELI5 block on GitHub', () => {
    expect(outboundDenial('addIssueComment', { body: 'Answer.\n\n+++ ELI5\nPlain.\n+++' })).toContain('<details>')
    expect(outboundDenial('addIssueComment', { body: `Answer.\n\n${ELI5}` })).toBeNull()
  })

  it('refuses a comment that opens by narrating, but not one that merely mentions it later', () => {
    expect(outboundDenial('github__addIssueComment', { body: 'Let me check the drain and I\'ll report back.' })).toContain('narrating')
    expect(outboundDenial('addPullRequestComment', { body: 'Looking at the trace, the retry runs twice. I\'ll leave the fix to you.' })).toBeNull()
    expect(outboundDenial('createIssue', { title: 'Retry runs twice', body: 'I\'ll describe the repro: run the drain twice.' })).toBeNull()
  })

  it('accepts a short pull request body with proof and ELI5', () => {
    expect(outboundDenial('createPullRequest', pullRequest(`Logs now carry user.id.\n\n${PROOF}\n\n${ELI5}`))).toBeNull()
    expect(outboundDenial('createPullRequest', pullRequest(`Before and after.\n\n| | before | after |\n|---|---|---|\n| user.id | missing | sent |\n\n${ELI5}`))).toBeNull()
  })

  it('requires proof outside the ELI5', () => {
    const proofOnlyInEli5 = `Logs now carry user.id.\n\n<details>\n<summary>ELI5</summary>\n\n\`\`\`\nok\n\`\`\`\n\n</details>`
    expect(outboundDenial('createPullRequest', pullRequest(proofOnlyInEli5))).toContain('no proof')
  })

  it('refuses placeholders in prose but not inside quoted output', () => {
    expect(outboundDenial('createPullRequest', pullRequest(`Fix.\n\n${PROOF}\n\nTODO: paste the payload.\n\n${ELI5}`))).toContain('placeholder')
    expect(outboundDenial('createPullRequest', pullRequest(`Fix.\n\n\`\`\`\n// TODO kept from source\n\`\`\`\n\n${ELI5}`))).toBeNull()
  })

  it('requires the ELI5 disclosure at the end', () => {
    expect(outboundDenial('createPullRequest', pullRequest(`Fix.\n\n${PROOF}`))).toContain('ELI5')
  })

  it('counts prose words only, so long proof does not count against the limit', () => {
    const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')
    expect(outboundDenial('createPullRequest', pullRequest(`${words(PR_PROSE_WORD_LIMIT)}\n\n${PROOF}\n\n${ELI5}`))).toBeNull()
    expect(outboundDenial('createPullRequest', pullRequest(`${words(PR_PROSE_WORD_LIMIT + 1)}\n\n${PROOF}\n\n${ELI5}`))).toContain(`${PR_PROSE_WORD_LIMIT + 1} words`)
    expect(outboundDenial('createPullRequest', pullRequest(`Fix.\n\n\`\`\`\n${words(1000)}\n\`\`\`\n\n${ELI5}`))).toBeNull()
  })

  it('checks the pull request title shape', () => {
    expect(outboundDenial('createPullRequest', pullRequest(`Fix.\n\n${PROOF}\n\n${ELI5}`, 'fix(sentry): Send user.id'))).toContain('lowercase')
    expect(outboundDenial('createPullRequest', pullRequest(`Fix.\n\n${PROOF}\n\n${ELI5}`, 'Fix sentry user id'))).toContain('Conventional Commits')
    expect(outboundDenial('createPullRequest', pullRequest(`Fix.\n\n${PROOF}\n\n${ELI5}`, 'feat(core)!: detect credentials by value'))).toBeNull()
  })

  it('leaves an updatePullRequest without a body to its title check', () => {
    expect(outboundDenial('updatePullRequest', { title: 'docs: fix a typo' })).toBeNull()
  })

  it('applies the pull request checks to pull requests only', () => {
    expect(outboundDenial('createIssue', { title: 'Retry runs twice', body: 'No proof yet, just the report.' })).toBeNull()
  })
})
