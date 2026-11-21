import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ampApiKey,
  ampApiKeyProblem,
  ampCliCandidates,
  AMP_CLI_SETTINGS,
  ampExecuteArgs,
  ampThreadTitle,
  ampThreadUrl,
  AMP_LINEAR_LABEL,
  buildAmpPrompt,
  decideAmpRoute,
  emptyAmpStreamState,
  foldAmpLine,
  parseAmpNdjson,
  runAmpExecute,
  type AmpProcess,
} from './amp'
import { PR_ATTRIBUTION_FOOTER, renderPrAttribution } from './github/outbound'

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

describe('decideAmpRoute', () => {
  it('delegates when the Linear amp label is present, even for a small edit', () => {
    expect(decideAmpRoute({ labels: ['bug', 'Amp'], filesToChange: 1 })).toEqual({ delegate: true, reason: 'label' })
  })

  it('delegates when the person asked for Amp', () => {
    expect(decideAmpRoute({ explicit: true, filesToChange: 1 })).toEqual({ delegate: true, reason: 'explicit' })
  })

  it('delegates refactors, work that needs tests, and more than two files', () => {
    expect(decideAmpRoute({ isRefactor: true })).toEqual({ delegate: true, reason: 'refactor' })
    expect(decideAmpRoute({ needsTests: true })).toEqual({ delegate: true, reason: 'tests' })
    expect(decideAmpRoute({ filesToChange: 3 })).toEqual({ delegate: true, reason: 'multi-file' })
  })

  it('keeps single-file work, questions, and housekeeping', () => {
    expect(decideAmpRoute({})).toEqual({ delegate: false, reason: 'keep' })
    expect(decideAmpRoute({ filesToChange: 2 })).toEqual({ delegate: false, reason: 'keep' })
    expect(decideAmpRoute({ filesToChange: 1, needsTests: false })).toEqual({ delegate: false, reason: 'keep' })
  })
})

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

describe('ampThreadUrl', () => {
  it('builds the public thread URL only for Amp session ids', () => {
    expect(ampThreadUrl('T-f9941a55-3765-421e-972f-05dc1138c3a3')).toBe(
      'https://ampcode.com/threads/T-f9941a55-3765-421e-972f-05dc1138c3a3',
    )
    expect(ampThreadUrl('https://evil.example/T-f9941a55-3765-421e-972f-05dc1138c3a3')).toBeNull()
    expect(ampThreadUrl(null)).toBeNull()
  })
})

describe('ampApiKey', () => {
  it('treats missing and blank as missing, and rejects login session tokens', () => {
    expect(ampApiKey({})).toBeNull()
    expect(ampApiKey({ AMP_API_KEY: '  ' })).toBeNull()
    expect(ampApiKeyProblem(null)).toBe('missing')
    expect(ampApiKeyProblem('amp_login_token')).toBe('session-token')
    expect(ampApiKeyProblem('sgamp_live_example')).toBeNull()
  })
})

describe('ampExecuteArgs and ampCliCandidates', () => {
  it('runs execute mode on a private orb with the project set', () => {
    expect(AMP_CLI_SETTINGS).toEqual({
      'amp.git.commit.coauthor.enabled': false,
      'amp.git.commit.ampThread.enabled': false,
    })
    expect(ampExecuteArgs({ project: 'evloghq/evlog', title: 'Fix the drain flush', settingsFile: '/tmp/evi-amp-settings.json' })).toEqual([
      '--execute',
      '--stream-json',
      '--visibility', 'private',
      '--executor', 'orb',
      '--project', 'evloghq/evlog',
      '--title', 'Fix the drain flush',
      '--mode', 'high',
      '--no-archive-after-execute',
      '--settings-file', '/tmp/evi-amp-settings.json',
      '--label', 'evi',
    ])
  })

  it('prefers AMP_CLI, otherwise amp then npx', () => {
    expect(ampCliCandidates({ AMP_CLI: '/opt/amp' })).toEqual([{ command: '/opt/amp', prefix: [] }])
    expect(ampCliCandidates({})).toEqual([
      { command: 'amp', prefix: [] },
      { command: 'npx', prefix: ['--yes', '@ampcode/cli'] },
    ])
  })

  it('keeps titles to one line and refuses a leading dash that looks like a flag', () => {
    expect(ampThreadTitle('Fix the\nflush')).toBe('Fix the flush')
    expect(ampThreadTitle('-dangerous')).toBe('Evi: -dangerous')
  })
})

describe('buildAmpPrompt', () => {
  const prompt = buildAmpPrompt({
    brief: 'Split the Loki adapter across files and add tests.',
    repository: 'evloghq/evlog',
    branch: 'main',
    issue: 'EVL-42',
    paths: ['packages/evlog/src/adapters/loki.ts'],
    requester: 'hugorcd',
    channel: 'linear',
  })

  it('reuses Evi\'s GitHub attribution sentence as the first line of the PR body', () => {
    expect(PR_ATTRIBUTION_FOOTER).toBe('Generated by {app} for {requester} from {channel}.')
    expect(prompt).toContain(renderPrAttribution('Evi', 'hugorcd', 'linear'))
    expect(prompt).toContain('The first line of the pull request body must be exactly:')
  })

  it('forwards the brief, repo, branch, and the shipping rules Amp would otherwise miss', () => {
    expect(prompt).toContain('Split the Loki adapter across files and add tests.')
    expect(prompt).toContain('GitHub: evloghq/evlog')
    expect(prompt).toContain('Base branch: main')
    expect(prompt).toContain('Issue: EVL-42')
    expect(prompt).toContain('Never merge')
    expect(prompt).toContain('Co-authored-by')
    expect(prompt).toContain('Generated with')
    expect(prompt).toContain('Never use an em dash')
    expect(prompt).not.toContain('\u2014')
    expect(prompt).toContain('Evi will verify')
  })
})

describe('runAmpExecute', () => {
  it('parses a successful stream from the first CLI that exists', async () => {
    const processAmp: AmpProcess = async (request) => {
      if (request.command === 'amp') return { enoent: true }
      expect(request.command).toBe('npx')
      expect(request.args.slice(0, 2)).toEqual(['--yes', '@ampcode/cli'])
      expect(request.args).toContain('--executor')
      expect(request.args).toContain('orb')
      expect(request.env.AMP_API_KEY).toBe('sgamp_test')
      expect(request.env.CI).toBe('1')
      expect(request.stdin).toContain('list files')
      return { stdout: SUCCESS_STREAM, stderr: '', exitCode: 0 }
    }

    const result = await runAmpExecute({
      prompt: 'list files',
      project: 'evloghq/evlog',
      title: 'list files',
      apiKey: 'sgamp_test',
    }, processAmp)

    expect(result.cliMissing).toBe(false)
    expect(result.state.summary).toBe('8')
    expect(result.state.threadId).toBe('T-f9941a55-3765-421e-972f-05dc1138c3a3')
  })

  it('reports a missing CLI after every candidate returns ENOENT', async () => {
    const result = await runAmpExecute({
      prompt: 'noop',
      project: 'evloghq/evlog',
      title: 'noop',
      apiKey: 'sgamp_test',
    }, async () => ({ enoent: true }))

    expect(result.cliMissing).toBe(true)
    expect(result.state.finished).toBe(false)
  })
})

describe('amp skill', () => {
  it('names the same Linear label and routes as decideAmpRoute', () => {
    const skill = readFileSync(join(import.meta.dirname, '..', 'skills', 'amp', 'SKILL.md'), 'utf8')
    expect(skill).toContain(`\`${AMP_LINEAR_LABEL}\``)
    expect(skill).toContain('amp__execute')
    expect(skill).toContain('more than two files')
    expect(skill).toContain('Never merge')
  })
})
