import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDb, createContext } from './helpers.js'
import { onRequestPost, generateCode } from '../api/shorten.js'

const SHORTEN_URL = 'https://example.test/api/shorten'

async function getLink(db, short_code) {
  return db.prepare('SELECT * FROM links WHERE short_code = ?').bind(short_code).first()
}

test('valid http and https URLs return 200', async () => {
  const { db, dispose } = await createTestDb()

  for (const url of ['https://example.com/page', 'http://example.com/page']) {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url } }))
    assert.equal(res.status, 200)
  }
  await dispose()
})

test('a non-http(s) protocol (ftp://) returns 400', async () => {
  const { db, dispose } = await createTestDb()

  const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'ftp://example.com' } }))

  assert.equal(res.status, 400)
  await dispose()
})

test('a javascript: URL returns 400', async () => {
  const { db, dispose } = await createTestDb()

  const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'javascript:alert(1)' } }))

  assert.equal(res.status, 400)
  await dispose()
})

test('an unparseable string returns 400', async () => {
  const { db, dispose } = await createTestDb()

  const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'not a url' } }))

  assert.equal(res.status, 400)
  await dispose()
})

test('the response created_at exactly matches the value stored in the database', async () => {
  const { db, dispose } = await createTestDb()

  const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
  const { short_code, created_at } = await res.json()
  const link = await getLink(db, short_code)

  assert.equal(created_at, link.created_at)
  await dispose()
})

test('the response created_at is ISO 8601 with an explicit Z (UTC) marker', async () => {
  const { db, dispose } = await createTestDb()

  const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
  const { created_at } = await res.json()

  assert.match(created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  await dispose()
})

test('the response created_at parses (as UTC) to a time close to now', async () => {
  const { db, dispose } = await createTestDb()

  const before = Date.now()
  const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
  const after = Date.now()
  const { created_at } = await res.json()
  const parsed = new Date(created_at).getTime()

  assert.ok(parsed >= before - 1000 && parsed <= after + 1000, `expected ${parsed} to be within a second of [${before}, ${after}]`)
  await dispose()
})

test('the response short_code exists in the database with the matching target_url', async () => {
  const { db, dispose } = await createTestDb()

  const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com/page' } }))
  const { short_code, target_url } = await res.json()
  const link = await getLink(db, short_code)

  assert.ok(link)
  assert.equal(target_url, 'https://example.com/page')
  assert.equal(link.target_url, 'https://example.com/page')
  await dispose()
})

test('the response delete_token matches the value stored in the database', async () => {
  const { db, dispose } = await createTestDb()

  const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
  const { short_code, delete_token } = await res.json()
  const link = await getLink(db, short_code)

  assert.equal(delete_token, link.delete_token)
  await dispose()
})

test('two consecutive requests get different delete_tokens', async () => {
  const { db, dispose } = await createTestDb()

  const resA = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com/a' } }))
  const resB = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com/b' } }))
  const { delete_token: tokenA } = await resA.json()
  const { delete_token: tokenB } = await resB.json()

  assert.notEqual(tokenA, tokenB)
  await dispose()
})

test('a newly created row has deleted_at = null and clicks = 0', async () => {
  const { db, dispose } = await createTestDb()

  const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
  const { short_code } = await res.json()
  const link = await getLink(db, short_code)

  assert.equal(link.deleted_at, null)
  assert.equal(link.clicks, 0)
  await dispose()
})

test('generateCode returns a code of the requested length using only alphabet characters', () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const code = generateCode(8)

  assert.equal(code.length, 8)
  for (const char of code) {
    assert.ok(alphabet.includes(char), `unexpected character "${char}" in generated code`)
  }
})

test('generateCode produces no duplicates across 10,000 calls', () => {
  const codes = new Set()
  for (let i = 0; i < 10_000; i++) {
    codes.add(generateCode())
  }

  assert.equal(codes.size, 10_000)
})
