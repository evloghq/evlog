import { defineWorkflowTool } from 'eve/tools'
import { runSimplificationSweep, simplificationInputSchema } from '../lib/simplification/workflow'

export default defineWorkflowTool({
  description: 'Run Evi\'s bounded repository simplification audit. Verify that the shared checkout matches the supplied full commit SHA, fan out exact code, test, architecture, and communication scopes to independent hidden reviewers, then have a fifth reviewer try to disprove every finding. Returns reviewer health, limitations, exact counts, and verified candidates. Use only after reading the compact repo-health-sweep ledger, searching its rejected-findings file for the scoped paths, and checking out a clean current main.',
  inputSchema: simplificationInputSchema,
  availableInSubagents: false,
  execute: runSimplificationSweep,
})
