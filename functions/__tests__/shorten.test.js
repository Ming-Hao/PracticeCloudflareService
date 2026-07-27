import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withTestDb, createContext } from './helpers.js'
import { onRequestPost, generateCode } from '../api/shorten.js'

const SHORTEN_URL = 'https://example.test/api/shorten'

async function getLink(db, short_code) {
  return db.prepare('SELECT * FROM links WHERE short_code = ?').bind(short_code).first()
}

async function insertLink(db, short_code, target_url = 'https://example.com') {
  await db.prepare('INSERT INTO links (short_code, target_url, delete_token) VALUES (?, ?, ?)').bind(short_code, target_url, 'x').run()
}

async function countRows(db) {
  const { count } = await db.prepare('SELECT COUNT(*) as count FROM links').first()
  return count
}

test('valid http and https URLs return 200', async () => {
  await withTestDb(async (db) => {
    for (const url of ['https://example.com/page', 'http://example.com/page']) {
      const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url } }))
      assert.equal(res.status, 200)
    }
  })
})

test('a non-http(s) protocol (ftp://) returns 400', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'ftp://example.com' } }))
    assert.equal(res.status, 400)
  })
})

test('a javascript: URL returns 400', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'javascript:alert(1)' } }))
    assert.equal(res.status, 400)
  })
})

test('an unparseable string returns 400', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'not a url' } }))
    assert.equal(res.status, 400)
  })
})

// These two currently pass by coincidence — new URL(123) and new URL(undefined)
// both throw, landing in the same catch as a genuinely malformed URL string. P0-4
// will replace that coincidence with an explicit typeof check; this test protects
// the 400 status across that change regardless of which code path produces it.
test('a non-string url ({"url": 123}) returns 400', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 123 } }))
    assert.equal(res.status, 400)
  })
})

test('a missing url field ({}) returns 400', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: {} }))
    assert.equal(res.status, 400)
  })
})

test('a malformed JSON body returns 400, not 500', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, rawBody: '{not json' }))
    assert.equal(res.status, 400)
  })
})

test('the response created_at exactly matches the value stored in the database', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
    const { short_code, created_at } = await res.json()
    const link = await getLink(db, short_code)
    assert.equal(created_at, link.created_at)
  })
})

test('the response created_at is ISO 8601 with an explicit Z (UTC) marker', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
    const { created_at } = await res.json()
    assert.match(created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

test('the response created_at parses (as UTC) to a time close to now', async () => {
  await withTestDb(async (db) => {
    const before = Date.now()
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
    const after = Date.now()
    const { created_at } = await res.json()
    const parsed = new Date(created_at).getTime()
    assert.ok(parsed >= before - 1000 && parsed <= after + 1000, `expected ${parsed} to be within a second of [${before}, ${after}]`)
  })
})

test('the response short_code exists in the database with the matching target_url', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com/page' } }))
    const { short_code, target_url } = await res.json()
    const link = await getLink(db, short_code)
    assert.ok(link)
    assert.equal(target_url, 'https://example.com/page')
    assert.equal(link.target_url, 'https://example.com/page')
  })
})

test('the response delete_token matches the value stored in the database', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
    const { short_code, delete_token } = await res.json()
    const link = await getLink(db, short_code)
    assert.equal(delete_token, link.delete_token)
  })
})

test('two consecutive requests get different delete_tokens', async () => {
  await withTestDb(async (db) => {
    const resA = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com/a' } }))
    const resB = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com/b' } }))
    const { delete_token: tokenA } = await resA.json()
    const { delete_token: tokenB } = await resB.json()
    assert.notEqual(tokenA, tokenB)
  })
})

test('a newly created row has deleted_at = null and clicks = 0', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
    const { short_code } = await res.json()
    const link = await getLink(db, short_code)
    assert.equal(link.deleted_at, null)
    assert.equal(link.clicks, 0)
  })
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

test('generateCode produces a roughly uniform character distribution across 10,000 codes', () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const counts = new Map(Array.from(alphabet, (c) => [c, 0]))
  const runs = 10_000

  for (let i = 0; i < runs; i++) {
    for (const char of generateCode()) counts.set(char, counts.get(char) + 1)
  }

  const expected = (runs * 6) / alphabet.length
  for (const [char, count] of counts) {
    assert.ok(
      count >= expected * 0.8 && count <= expected * 1.2,
      `character "${char}" appeared ${count} times, expected within 20% of ${expected}`,
    )
  }
})

test('a colliding code from the generator is retried until a free one is found', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, 'EXIST1')
    let calls = 0
    const codeGenerator = () => {
      calls++
      return calls <= 2 ? 'EXIST1' : 'FRESH1'
    }

    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }), { codeGenerator })
    const body = await res.json()

    assert.equal(res.status, 200)
    assert.equal(body.short_code, 'FRESH1')
  })
})

// Currently true "by accident": the insert only ever runs once regardless of error
// type, since there's no retry-on-insert-failure loop yet (P0-2). Once that loop
// exists, this test starts doing real work — verifying the retry is scoped to
// UNIQUE-constraint collisions only, not any DB error.
test('a non-UNIQUE DB error is not retried and surfaces as 500', async () => {
  let generatorCalls = 0
  const codeGenerator = () => {
    generatorCalls++
    return 'ANYCODE'
  }
  const fakeDb = {
    prepare() {
      return {
        bind() {
          return this
        },
        async run() {
          throw new Error('SQLITE_IOERR: disk I/O error')
        },
        async first() {
          return null
        },
      }
    },
  }

  const res = await onRequestPost(createContext({ db: fakeDb, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }), {
    codeGenerator,
  })

  assert.equal(res.status, 500)
  assert.equal(generatorCalls, 1)
})

// --- Deferred tests: [DEFERRED] marks behaviour we have decided NOT to implement in
// this round (P0-4 was reclassified as hardening, not a bug). They are marked
// `{ todo: true }` so node:test still runs them and reports them under "# todo"
// without failing the suite — a green `npm test` therefore means "nothing
// unexpected", while the todo count is the backlog for the next round.
// When one of these starts passing, drop the marker instead of leaving it stale. ---

test('[DEFERRED, P0-4] a syntactically valid but 2048+ character url returns 400', { todo: true }, async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(
      createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com/' + 'a'.repeat(3000) } }),
    )
    assert.equal(res.status, 400)
  })
})

test('[DEFERRED, P0-4] a url pointing at this service\'s own domain returns 400', { todo: true }, async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.test/abc' } }))
    assert.equal(res.status, 400)
  })
})

// --- Red tests: these fail against the current implementation and are expected to
// stay red until the corresponding code-review fix lands. Do not "fix" these tests
// to make them pass — fix the handler instead. ---

test('[RED, P0-2] exhausting all collision retries returns 503 and inserts no row', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, 'EXIST1')
    const before = await countRows(db)
    const codeGenerator = () => 'EXIST1'

    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }), { codeGenerator })

    assert.equal(res.status, 503)
    assert.equal(await countRows(db), before)
  })
})
