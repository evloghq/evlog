import { askQuestion } from 'eve/tools/ask_question'

// Not a default tool since eve 0.65: opt back in so sessions can still ask
// the maintainer a question with options instead of guessing.
export default askQuestion()
