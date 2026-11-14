import { disableTool } from 'eve/tools'
import { describe, expect, it } from 'vitest'
import reviewSandbox from '../review-sandbox'
import architectureAgent from '../../subagents/architecture_reviewer/agent'
import architectureSandbox from '../../subagents/architecture_reviewer/sandbox/sandbox'
import architectureShell from '../../subagents/architecture_reviewer/tools/bash'
import architectureWrite from '../../subagents/architecture_reviewer/tools/write_file'
import codeAgent from '../../subagents/code_simplifier/agent'
import codeSandbox from '../../subagents/code_simplifier/sandbox/sandbox'
import codeShell from '../../subagents/code_simplifier/tools/bash'
import codeWrite from '../../subagents/code_simplifier/tools/write_file'
import communicationAgent from '../../subagents/communication_reviewer/agent'
import communicationSandbox from '../../subagents/communication_reviewer/sandbox/sandbox'
import communicationShell from '../../subagents/communication_reviewer/tools/bash'
import communicationWrite from '../../subagents/communication_reviewer/tools/write_file'
import testAgent from '../../subagents/test_reviewer/agent'
import testSandbox from '../../subagents/test_reviewer/sandbox/sandbox'
import testShell from '../../subagents/test_reviewer/tools/bash'
import testWrite from '../../subagents/test_reviewer/tools/write_file'
import verifierAgent from '../../subagents/finding_verifier/agent'
import verifierSandbox from '../../subagents/finding_verifier/sandbox/sandbox'
import verifierShell from '../../subagents/finding_verifier/tools/bash'
import verifierWrite from '../../subagents/finding_verifier/tools/write_file'

const specialists = [
  ['code', codeAgent, codeSandbox, codeShell, codeWrite],
  ['tests', testAgent, testSandbox, testShell, testWrite],
  ['architecture', architectureAgent, architectureSandbox, architectureShell, architectureWrite],
  ['communication', communicationAgent, communicationSandbox, communicationShell, communicationWrite],
  ['verifier', verifierAgent, verifierSandbox, verifierShell, verifierWrite],
] as const

describe.each(specialists)('%s simplification specialist', (_name, agent, sandboxDefinition, shell, write) => {
  it('stays hidden from the root model', () => {
    expect(agent.tool).toBe(false)
  })

  it('inherits the parent workspace', () => {
    expect(sandboxDefinition).toBe(reviewSandbox)
  })

  it('has no shell or file-write tool', () => {
    expect(shell).toEqual(disableTool())
    expect(write).toEqual(disableTool())
  })
})
