import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AgentMessageResult, AgentSession, WorkflowToolContext } from 'eve/tools'
import { describe, expect, it } from 'vitest'
import { renderArchiveSection, renderRejectedLines, SWEEP_RESULTS_DIR, SWEEP_TOOL_NAME, sweepRecord, writeSweepRecord } from './record'
import { runSimplificationSweep } from './workflow'

const revision = `74f4423${ 'b'.repeat(33)}`
const at = '2026-11-20T09:15:00.000Z'

const candidate = {
  id: 'ignored',
  category: 'code' as const,
  kind: 'remove' as const,
  lines: '10-14',
  evidence: 'Both callers validate first.',
  simplification: 'Drop the guard.',
  preservedBehavior: 'Invalid values stay rejected.',
  risk: 'A new caller could skip validation.',
  confidence: 0.9,
}

/** A real sweep run: the code reviewer reports two candidates, the verifier keeps one and rejects the other. */
function sweep() {
  const agent = (target: string): AgentSession => ({
    send: <TOutput>(message: string) => {
      let data: unknown
      if (target === 'finding_verifier' && message.includes('before any review starts')) data = { revision }
      else if (target === 'finding_verifier') {
        data = {
          findings: [
            { id: 'code-1', verdict: 'confirmed', delivery: 'pull_request', verification: 'No counterexample.' },
            { id: 'code-2', verdict: 'rejected', delivery: 'question', verification: 'Load-bearing: callHook returns undefined.' },
          ],
          summary: 'One of two survived.',
        }
      } else {
        data = {
          scope: `${target} scope`,
          status: 'complete',
          limitations: [],
          findings: target === 'code_simplifier'
            ? [
              { ...candidate, path: 'packages/evlog/src/adapters/fs.ts', problem: 'Unused type.' },
              { ...candidate, path: 'packages/evlog/src/nitro-v3/plugin.ts', problem: 'Defensive catch.' },
            ]
            : [],
          cleanAreas: [],
        }
      }
      const result: AgentMessageResult = { status: 'completed', data, reply: undefined, sessionEnded: false }
      return Promise.resolve({ result: () => Promise.resolve(result as AgentMessageResult<TOutput>) })
    },
  })
  return runSimplificationSweep({
    revision,
    codeScope: 'packages/evlog/src/adapters/',
    testScope: 'packages/evlog/test/nitro/',
    architectureScope: 'cli vs exports',
    communicationScope: 'instructions.md',
    priorDecisions: [],
  }, { agent } satisfies Pick<WorkflowToolContext, 'agent'>)
}

describe('sweep record', () => {
  it('names the tool the hook listens for', () => {
    const tool = fileURLToPath(new URL(`../../tools/${SWEEP_TOOL_NAME}.ts`, import.meta.url))
    expect(existsSync(tool)).toBe(true)
  })

  it('writes one rejected line per rejected finding, pointing at the archive section of the run', async () => {
    const result = await sweep()
    const lines = renderRejectedLines(result, at).trimEnd().split('\n').map(line => JSON.parse(line))

    expect(lines).toEqual([
      {
        area: 'code',
        paths: ['packages/evlog/src/nitro-v3/plugin.ts'],
        claim: 'code-2: Defensive catch.',
        reason: 'Load-bearing: callHook returns undefined.',
        date: '2026-11-20',
        revision,
        source: 'archive/2026-11.md#Run 2026-11-20, revision 74f4423',
      }
    ])
    expect(renderArchiveSection(result, at).split('\n')[0]).toBe('## Run 2026-11-20, revision 74f4423')
  })

  it('keeps every reviewer status, the counts and each verdict in the archive section', async () => {
    const section = renderArchiveSection(await sweep(), at)

    expect(section).toContain('- `test_reviewer`: complete')
    expect(section).toContain('Counts: 2 proposed, 1 confirmed, 1 rejected, 0 questions, 0 proposals, 1 pull-request candidates in 1 batches.')
    expect(section).toContain('- code-1 (remove, `packages/evlog/src/adapters/fs.ts:10-14`): confirmed, pull_request.')
    expect(section).toContain('- code-2 (remove, `packages/evlog/src/nitro-v3/plugin.ts:10-14`): rejected, question.')
  })

  it('writes the full result outside the checkout, one directory per call', async () => {
    const result = await sweep()
    const calls: string[] = []
    const written = new Map<string, string>()
    await writeSweepRecord({
      run: ({ command }) => {
        calls.push(command)
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      },
      writeTextFile: ({ path, content }) => {
        written.set(path, content)
        return Promise.resolve()
      },
    } as Parameters<typeof writeSweepRecord>[0], sweepRecord(result, at, 'call_1'))

    const dir = `${SWEEP_RESULTS_DIR}/2026-11-20-74f4423-call_1`
    expect(calls).toEqual([`mkdir -p '${dir}'`])
    expect([...written.keys()]).toEqual([`${dir}/result.json`, `${dir}/archive-section.md`, `${dir}/rejected.jsonl`])
    expect(JSON.parse(written.get(`${dir}/result.json`)!)).toEqual(result)
    expect(dir.startsWith('/workspace/repo')).toBe(false)
  })
})
