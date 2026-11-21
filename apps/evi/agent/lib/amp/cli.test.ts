import { describe, expect, it } from 'vitest'
import {
  AMP_CLI_SETTINGS,
  ampCliCandidates,
  ampContinueArgs,
  ampLaunchArgs,
  ampListArgs,
  ampMarkdownArgs,
  ampSearchArgs,
  emptyAmpStreamState,
  foldAmpLine,
  parseAmpLaunch,
  parseAmpNdjson,
  runAmpContinue,
  runAmpLaunch,
  type AmpProcess,
} from './cli'

const SUCCESS_STREAM = [
  '{"type":"system","subtype":"init","cwd":"/Users/orb","session_id":"T-f9941a55-3765-421e-972f-05dc1138c3a3","tools":["Bash"],"mcp_servers":[]}',
  '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"what is 3 + 5?"}]},"parent_tool_use_id":null,"session_id":"T-f9941a55-3765-421e-972f-05dc1138c3a3"}',
  '{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"8"}],"stop_reason":"end_turn"},"parent_tool_use_id":null,"session_id":"T-f9941a55-3765-421e-972f-05dc1138c3a3"}',
  '{"type":"result","subtype":"success","duration_ms":5400,"is_error":false,"num_turns":1,"result":"8","session_id":"T-f9941a55-3765-421e-972f-05dc1138c3a3"}',
].join('\n')

const ERROR_STREAM = [
  '{"type":"system","subtype":"init","session_id":"T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","tools":[],"mcp_servers":[]}',
  '{"type":"result","subtype":"error_during_execution","duration_ms":12,"is_error":true,"num_turns":0,"error":"orb exploded","session_id":"T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}',
].join('\n')

describe('parseAmpNdjson', () => {
  it('reads thread id, success, summary, and stats from the documented stream-json example', () => {
    expect(parseAmpNdjson(SUCCESS_STREAM)).toEqual({
      threadId: 'T-f9941a55-3765-421e-972f-05dc1138c3a3',
      summary: '8',
      error: null,
      isError: false,
      finished: true,
      durationMs: 5400,
      turns: 1,
    })
  })

  it('skips npx noise and broken lines, and still folds the result', () => {
    const noisy = `npm warn exec The following package was not found and will be installed.\nnot json\n{not json\n${SUCCESS_STREAM}`
    expect(parseAmpNdjson(noisy).summary).toBe('8')
    expect(parseAmpNdjson(noisy).threadId).toBe('T-f9941a55-3765-421e-972f-05dc1138c3a3')
  })

  it('records an execute error without dropping the thread id', () => {
    expect(parseAmpNdjson(ERROR_STREAM)).toMatchObject({
      threadId: 'T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      finished: true,
      isError: true,
      error: 'orb exploded',
      summary: null,
    })
  })

  it('keeps the init thread id when the stream is cut off before a result', () => {
    const init = '{"type":"system","subtype":"init","session_id":"T-f9941a55-3765-421e-972f-05dc1138c3a3","tools":[],"mcp_servers":[]}'
    expect(foldAmpLine(emptyAmpStreamState(), init)).toEqual({
      ...emptyAmpStreamState(),
      threadId: 'T-f9941a55-3765-421e-972f-05dc1138c3a3',
    })
  })
})

describe('parseAmpLaunch', () => {
  it('reads the thread URL Amp prints when -ox returns immediately', () => {
    const noisy = 'npm warn exec installing\nhttps://ampcode.com/threads/T-f9941a55-3765-421e-972f-05dc1138c3a3\n'
    expect(parseAmpLaunch(noisy)).toEqual({
      threadId: 'T-f9941a55-3765-421e-972f-05dc1138c3a3',
      threadUrl: 'https://ampcode.com/threads/T-f9941a55-3765-421e-972f-05dc1138c3a3',
    })
  })

  it('falls back to stream-json session_id when no URL was printed', () => {
    expect(parseAmpLaunch(SUCCESS_STREAM)).toEqual({
      threadId: 'T-f9941a55-3765-421e-972f-05dc1138c3a3',
      threadUrl: 'https://ampcode.com/threads/T-f9941a55-3765-421e-972f-05dc1138c3a3',
    })
  })
})

describe('amp CLI args', () => {
  it('launches a private orb without attaching to stream-json', () => {
    expect(AMP_CLI_SETTINGS).toEqual({
      'amp.git.commit.coauthor.enabled': false,
      'amp.git.commit.ampThread.enabled': false,
    })
    expect(ampLaunchArgs({ project: 'evloghq/evlog', title: 'Fix the drain flush', settingsFile: '/tmp/evi-amp-settings.json' })).toEqual([
      '--execute',
      '--visibility',
      'private',
      '--executor',
      'orb',
      '--project',
      'evloghq/evlog',
      '--title',
      'Fix the drain flush',
      '--mode',
      'high',
      '--no-archive-after-execute',
      '--settings-file',
      '/tmp/evi-amp-settings.json',
      '--label',
      'evi',
    ])
    expect(ampLaunchArgs({ project: 'evloghq/evlog', title: 'x', settingsFile: '/tmp/x.json' })).not.toContain('--stream-json')
  })

  it('continues an existing thread on its orb without resetting project or mode', () => {
    expect(ampContinueArgs({ threadId: 'T-f9941a55-3765-421e-972f-05dc1138c3a3', settingsFile: '/tmp/evi-amp-settings.json' })).toEqual([
      'threads',
      'continue',
      'T-f9941a55-3765-421e-972f-05dc1138c3a3',
      '--execute',
      '--visibility',
      'private',
      '--executor',
      'orb',
      '--no-archive-after-execute',
      '--settings-file',
      '/tmp/evi-amp-settings.json',
    ])
    expect(ampListArgs()).toEqual(['threads', 'list', '--json', '-n', '50'])
    expect(ampSearchArgs('EVL-42')).toEqual(['threads', 'search', 'EVL-42', '--json', '-n', '10'])
    expect(ampMarkdownArgs('T-f9941a55-3765-421e-972f-05dc1138c3a3')).toEqual(['threads', 'markdown', 'T-f9941a55-3765-421e-972f-05dc1138c3a3'])
  })

  it('prefers AMP_CLI, otherwise amp then npx', () => {
    expect(ampCliCandidates({ AMP_CLI: '/opt/amp' })).toEqual([{ command: '/opt/amp', prefix: [] }])
    expect(ampCliCandidates({})).toEqual([
      { command: 'amp', prefix: [] },
      { command: 'npx', prefix: ['--yes', '@ampcode/cli'] },
    ])
  })
})

describe('runAmpLaunch and runAmpContinue', () => {
  it('parses a fire-and-forget thread URL from the first CLI that exists', async () => {
    const processAmp: AmpProcess = (request) => {
      if (request.command === 'amp') return Promise.resolve({ enoent: true })
      expect(request.command).toBe('npx')
      expect(request.args.slice(0, 2)).toEqual(['--yes', '@ampcode/cli'])
      expect(request.args).toContain('--executor')
      expect(request.args).toContain('orb')
      expect(request.args).not.toContain('--stream-json')
      expect(request.env.AMP_API_KEY).toBe('sgamp_test')
      expect(request.env.CI).toBe('1')
      expect(request.stdin).toContain('list files')
      return Promise.resolve({ stdout: 'https://ampcode.com/threads/T-f9941a55-3765-421e-972f-05dc1138c3a3\n', stderr: '', exitCode: 0 })
    }

    const result = await runAmpLaunch({
      prompt: 'list files',
      project: 'evloghq/evlog',
      title: 'list files',
      apiKey: 'sgamp_test',
    }, processAmp)

    expect(result.cliMissing).toBe(false)
    expect(result.threadId).toBe('T-f9941a55-3765-421e-972f-05dc1138c3a3')
    expect(result.threadUrl).toBe('https://ampcode.com/threads/T-f9941a55-3765-421e-972f-05dc1138c3a3')
  })

  it('reports a missing CLI after every candidate returns ENOENT', async () => {
    const result = await runAmpLaunch({
      prompt: 'noop',
      project: 'evloghq/evlog',
      title: 'noop',
      apiKey: 'sgamp_test',
    }, () => Promise.resolve({ enoent: true }))

    expect(result.cliMissing).toBe(true)
    expect(result.threadId).toBeNull()
  })

  it('continues the named thread and keeps its id when stdout reprints the URL', async () => {
    const processAmp: AmpProcess = (request) => {
      expect(request.args).toContain('continue')
      expect(request.args).toContain('T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
      expect(request.args).not.toContain('--project')
      expect(request.stdin).toContain('the check failed')
      return Promise.resolve({ stdout: 'https://ampcode.com/threads/T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n', stderr: '', exitCode: 0 })
    }

    const result = await runAmpContinue({
      threadId: 'T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      prompt: 'the check failed',
      apiKey: 'sgamp_test',
    }, processAmp)

    expect(result.cliMissing).toBe(false)
    expect(result.threadId).toBe('T-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })
})
