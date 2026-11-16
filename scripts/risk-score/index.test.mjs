import { describe, expect, it, vi } from 'vitest'
import { publishRiskScore } from './index.mjs'
import { COMMENT_MARKER } from './lib.mjs'

const SHA = 'fedcba9876543210fedcba9876543210fedcba98'

/** The slice of the Octokit client `actions/github-script` passes in. */
function fakeGithub({ comments, heads = [SHA], files, contents = {} }) {
  const listFiles = vi.fn()
  const listComments = vi.fn()
  const pages = new Map([
    [listFiles, files ?? [{ filename: 'packages/evlog/src/adapters/loki.ts', status: 'modified', additions: 4, deletions: 1 }]],
    [listComments, comments],
  ])
  return {
    paginate: vi.fn(async method => pages.get(method)),
    rest: {
      pulls: {
        // Each call returns the next head in `heads`, then keeps the last one.
        get: vi.fn(async () => ({ data: { title: 'fix(loki): flush on shutdown', user: { login: 'someone' }, author_association: 'MEMBER', base: { ref: 'main', sha: 'base', repo: { full_name: 'evloghq/evlog' } }, head: { sha: heads.length > 1 ? heads.shift() : heads[0], repo: { full_name: 'evloghq/evlog' } } } })),
        listFiles,
      },
      repos: {
        compareCommitsWithBasehead: vi.fn(async () => ({ data: { merge_base_commit: { sha: 'merge-base' } } })),
        getContent: vi.fn(async ({ path, ref }) => ({ data: JSON.stringify(contents[`${ref}:${path}`]) })),
      },
      issues: {
        listComments,
        createComment: vi.fn(async () => ({})),
        updateComment: vi.fn(async () => ({})),
      },
    },
  }
}

const context = { repo: { owner: 'evloghq', repo: 'evlog' }, payload: { pull_request: { number: 42 } } }
const core = { info: vi.fn() }

describe('publishRiskScore', () => {
  it('creates the comment on the first run', async () => {
    const github = fakeGithub({ comments: [{ id: 1, user: { login: 'someone' }, body: 'LGTM' }] })
    await publishRiskScore({ github, context, core })

    expect(github.rest.issues.updateComment).not.toHaveBeenCalled()
    const { body, issue_number } = github.rest.issues.createComment.mock.calls[0][0]
    expect(issue_number).toBe(42)
    expect(body).toContain(`"sha":"${SHA}"`)
  })

  it('updates its own comment instead of adding another', async () => {
    const github = fakeGithub({
      comments: [
        // A human quoting the marker must not have their comment overwritten.
        { id: 1, user: { login: 'someone' }, body: `${COMMENT_MARKER} quoted` },
        { id: 2, user: { login: 'github-actions[bot]' }, body: `${COMMENT_MARKER}\nold` },
      ],
    })
    await publishRiskScore({ github, context, core })

    expect(github.rest.issues.createComment).not.toHaveBeenCalled()
    expect(github.rest.issues.updateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 2 }))
  })

  it('publishes nothing when a push lands while the files are read', async () => {
    const github = fakeGithub({ comments: [], heads: [SHA, '0123456789abcdef0123456789abcdef01234567'] })
    await publishRiskScore({ github, context, core })

    expect(github.rest.issues.createComment).not.toHaveBeenCalled()
    expect(github.rest.issues.updateComment).not.toHaveBeenCalled()
  })

  it('scores a manifest from its merge base and head contents', async () => {
    const path = 'packages/evlog/package.json'
    const github = fakeGithub({
      comments: [],
      files: [{ filename: path, status: 'modified', additions: 1, deletions: 1 }],
      contents: {
        [`merge-base:${path}`]: { name: 'evlog', devDependencies: { vitest: '^4.0.0' } },
        [`${SHA}:${path}`]: { name: 'evlog', devDependencies: { vitest: '^4.1.0' } },
      },
    })
    await publishRiskScore({ github, context, core })

    const { body } = github.rest.issues.createComment.mock.calls[0][0]
    expect(body).toContain('### Risk score: Low (1/4)')
  })
})
