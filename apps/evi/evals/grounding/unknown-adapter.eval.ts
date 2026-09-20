import { defineEval } from 'eve/evals'

export default defineEval({
  description: 'An adapter that does not exist is reported as missing, not invented.',
  tags: ['slow'],
  async test(t) {
    await t.send('How do I configure the Splunk drain adapter in evlog?')
    t.succeeded()
    t.judge('states that evlog has no Splunk drain adapter, and does not present any Splunk configuration, import path, or option name as if it existed')
      .gate(0.7)
  },
})
