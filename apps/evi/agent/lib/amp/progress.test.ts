import { describe, expect, it } from 'vitest'
import {
  AMP_LAUNCH_PROGRESS_KEY,
  ampProgressUpdate,
  digestAmpProgress,
  parseAmpThreadList,
  pickAmpThread,
} from './progress'

const LIST_JSON = JSON.stringify({
  threads: [
    {
      id: 'T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      title: 'EVL-41: old work',
      url: 'https://ampcode.com/threads/T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      labels: ['evi'],
      status: 'idle',
    },
    {
      id: 'T-f9941a55-3765-421e-972f-05dc1138c3a3',
      title: 'EVL-42: Split the Loki adapter',
      labels: [{ name: 'evi' }],
      status: 'running',
    },
  ],
})

describe('parseAmpThreadList', () => {
  it('reads id, title, labels, and status from Amp list JSON, including object labels', () => {
    expect(parseAmpThreadList(`npm warn exec skip this\n${LIST_JSON}`)).toEqual([
      {
        id: 'T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        title: 'EVL-41: old work',
        url: 'https://ampcode.com/threads/T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        labels: ['evi'],
        status: 'idle',
      },
      {
        id: 'T-f9941a55-3765-421e-972f-05dc1138c3a3',
        title: 'EVL-42: Split the Loki adapter',
        url: 'https://ampcode.com/threads/T-f9941a55-3765-421e-972f-05dc1138c3a3',
        labels: ['evi'],
        status: 'running',
      },
    ])
  })

  it('picks the thread whose title carries the issue, newest first in the list', () => {
    const threads = parseAmpThreadList(LIST_JSON)
    expect(pickAmpThread(threads, { issue: 'EVL-42' })?.id).toBe('T-f9941a55-3765-421e-972f-05dc1138c3a3')
    expect(pickAmpThread(threads, { threadId: 'T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })?.title).toBe('EVL-41: old work')
    expect(pickAmpThread(threads, { issue: 'EVL-99' })).toBeNull()
  })
})

describe('digestAmpProgress', () => {
  const runningMarkdown = [
    '# EVL-42: Split the Loki adapter',
    '',
    'Status: running',
    '',
    'Editing packages/evlog/src/adapters/loki.ts and packages/evlog/test/adapters/loki.test.ts.',
  ].join('\n')

  const doneMarkdown = [
    '# EVL-42: Split the Loki adapter',
    '',
    'Opened https://github.com/evloghq/evlog/pull/900',
    '',
    'Checks: pnpm --filter evlog exec vitest run test/adapters/loki.test.ts passed.',
  ].join('\n')

  it('uses listed status and records files without treating every poll as an update', () => {
    const first = digestAmpProgress({ markdown: runningMarkdown, listed: parseAmpThreadList(LIST_JSON)[1] })
    expect(first.status).toBe('running')
    expect(first.prUrl).toBeNull()
    expect(first.files).toEqual([
      'packages/evlog/src/adapters/loki.ts',
      'packages/evlog/test/adapters/loki.test.ts',
    ])
    expect(first.key).not.toBe(AMP_LAUNCH_PROGRESS_KEY)
    expect(ampProgressUpdate(first, AMP_LAUNCH_PROGRESS_KEY, 'T-f9941a55-3765-421e-972f-05dc1138c3a3')).toBe(
      'Amp is still working on T-f9941a55-3765-421e-972f-05dc1138c3a3 (packages/evlog/src/adapters/loki.ts, packages/evlog/test/adapters/loki.test.ts).',
    )
    expect(ampProgressUpdate(first, first.key, 'T-f9941a55-3765-421e-972f-05dc1138c3a3')).toBeNull()
  })

  it('does not post when the first poll still looks like launch', () => {
    const empty = digestAmpProgress({ markdown: '' })
    expect(empty.key).toBe(AMP_LAUNCH_PROGRESS_KEY)
    expect(ampProgressUpdate(empty, AMP_LAUNCH_PROGRESS_KEY, 'T-f9941a55-3765-421e-972f-05dc1138c3a3')).toBeNull()
  })

  it('posts once when a pull request appears, then stays quiet', () => {
    const done = digestAmpProgress({ markdown: doneMarkdown, listed: { ...parseAmpThreadList(LIST_JSON)[0]!, status: 'idle' } })
    expect(done.status).toBe('idle')
    expect(done.prUrl).toBe('https://github.com/evloghq/evlog/pull/900')
    expect(ampProgressUpdate(done, AMP_LAUNCH_PROGRESS_KEY, 'T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(
      'Amp finished. Pull request: https://github.com/evloghq/evlog/pull/900',
    )
    expect(ampProgressUpdate(done, done.key, 'T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBeNull()
  })
})
