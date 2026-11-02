import { createConfig } from '@hrcd/eslint-config'

export default createConfig({}, {
  rules: {
    // Augmentable interfaces (`declare module 'evlog' { interface X {} }`) are
    // a first-class TS pattern and not catchable by this style rule.
    '@typescript-eslint/no-empty-object-type': 'off',
    // Pure formatting; clashes with `<pre><code>` blocks where a leading newline
    // is rendered as visible whitespace. Project consensus: not worth the noise.
    'vue/multiline-html-element-content-newline': 'off',
    // The default forces an empty line at the start of every class — pure
    // style noise with zero defect-prevention value. Keep `blocks` /
    // `switches` set to `'never'` (real readability) but drop the class rule.
    'padded-blocks': ['error', { blocks: 'never', switches: 'never' }],
  },
})
