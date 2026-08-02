import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveLinkClick } from '../linkClick.ts'

// Whether the probe (HEAD) and navigate (GET) themselves count as a click is the
// server's concern, covered by functions/__tests__/code.test.js — HEAD leaves `clicks`
// untouched, GET increments it. What matters here is that resolveLinkClick calls
// navigate at most once, and only when the probe says the link is live.

test('resolveLinkClick — a valid link probes once and navigates once', async () => {
  let probeCalls = 0
  let navigateCalls = 0
  const fakeFetch = async () => {
    probeCalls++
    return new Response(null, { status: 200 })
  }
  const fakeNavigate = () => {
    navigateCalls++
  }

  const result = await resolveLinkClick('https://example.com/AAAAAA', {
    fetch: fakeFetch,
    navigate: fakeNavigate,
  })

  assert.equal(result, 'navigated')
  assert.equal(probeCalls, 1)
  assert.equal(navigateCalls, 1)
})

test('resolveLinkClick — a failed probe still navigates', async () => {
  let probeCalls = 0
  let navigateCalls = 0
  const fakeFetch = async () => {
    probeCalls++
    // What an ad blocker, a dropped connection, or an offline tab actually produces.
    throw new TypeError('Failed to fetch')
  }
  const fakeNavigate = () => {
    navigateCalls++
  }

  const result = await resolveLinkClick('https://example.com/AAAAAA', {
    fetch: fakeFetch,
    navigate: fakeNavigate,
  })

  assert.equal(result, 'navigated')
  assert.equal(probeCalls, 1)
  assert.equal(navigateCalls, 1)
})

test('resolveLinkClick — a stale link probes once and never navigates', async () => {
  let probeCalls = 0
  let navigateCalls = 0
  const fakeFetch = async () => {
    probeCalls++
    return new Response(null, { status: 404 })
  }
  const fakeNavigate = () => {
    navigateCalls++
  }

  const result = await resolveLinkClick('https://example.com/AAAAAA', {
    fetch: fakeFetch,
    navigate: fakeNavigate,
  })

  assert.equal(result, 'stale')
  assert.equal(probeCalls, 1)
  assert.equal(navigateCalls, 0)
})
