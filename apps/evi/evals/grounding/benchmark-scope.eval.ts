import { defineEval } from 'eve/evals'

export default defineEval({
  description: 'Rejects a general speed claim from benchmarks doing different work.',
  tags: ['fast'],
  async test(t) {
    await t.send('Review this proposed sentence, without editing files: "Logger A is four times faster than Logger B in production." The only evidence is a benchmark where A runs with output disabled and B serializes each event to JSON and writes it to /dev/null. The reported operation counts are accurate. Can I publish the sentence? Explain your decision and what evidence would justify it.')
    t.succeeded()
    t.judge.autoevals.closedQA('Rejects the four-times-faster production conclusion because the benchmark compares different work, despite accurate counts. Requests comparable output, serialization and I/O conditions or limits the claim explicitly to the measured configurations.').gate(0.8)
  },
})
