import { defineSandbox } from 'eve/sandbox'

export default defineSandbox(({ parent }) => {
  if (parent === null) throw new Error('Content agents require a parent workspace.')
  return parent.sandbox
})
