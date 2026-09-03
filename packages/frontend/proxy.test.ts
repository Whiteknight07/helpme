import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRedirectAuthenticatedPublicPage } from './proxy'

test('keeps authenticated LTI deep-link launches on the public picker route', () => {
  assert.equal(
    shouldRedirectAuthenticatedPublicPage('/lti/deep-link', true, true),
    false,
  )
})
