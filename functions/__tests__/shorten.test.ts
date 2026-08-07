import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withTestDb, createContext } from './helpers.ts'
import { onRequestPost, generateCode, isPrivateHostname } from '../api/shorten.ts'

const SHORTEN_URL = 'https://example.test/api/shorten'

type LinkRow = {
  short_code: string
  target_url: string
  delete_token: string
  created_at: string
  deleted_at: string | null
  clicks: number
}

// Declared as always returning a row: every caller looks up a code the handler just reported
// creating, so a null here is a broken test rather than a case to handle.
async function getLink(db: D1Database, short_code: string) {
  return (await db.prepare('SELECT * FROM links WHERE short_code = ?').bind(short_code).first<LinkRow>())!
}

async function insertLink(db: D1Database, short_code: string, target_url = 'https://example.com') {
  await db.prepare('INSERT INTO links (short_code, target_url, delete_token) VALUES (?, ?, ?)').bind(short_code, target_url, 'x').run()
}

async function countRows(db: D1Database) {
  // An aggregate always produces exactly one row, so first() is never null here.
  const { count } = (await db.prepare('SELECT COUNT(*) as count FROM links').first<{ count: number }>())!
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

// request.json() ignores Content-Type, so without this guard a cross-site
// <form enctype="text/plain"> — a CORS simple request, sent with no preflight — reaches this
// endpoint and creates a row no one can delete (the attacker never sees the delete_token).
test('a request without a Content-Type returns 415', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(
      createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' }, headers: {} }),
    )
    assert.equal(res.status, 415)
    assert.equal(await countRows(db), 0)
  })
})

test('a text/plain Content-Type carrying valid JSON returns 415', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(
      createContext({
        db,
        method: 'POST',
        url: SHORTEN_URL,
        body: { url: 'https://example.com' },
        headers: { 'Content-Type': 'text/plain' },
      }),
    )
    assert.equal(res.status, 415)
    assert.equal(await countRows(db), 0)
  })
})

// The charset parameter must not be mistaken for a different media type: split on ';' first.
test('an application/json Content-Type with a charset parameter is accepted', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(
      createContext({
        db,
        method: 'POST',
        url: SHORTEN_URL,
        body: { url: 'https://example.com' },
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }),
    )
    assert.equal(res.status, 200)
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

// new URL() strips LF and CR from its input and accepts NUL, so all three parse as
// https://example.com/path and clear every check below. target_url keeps the raw string
// though, and those are the three characters a header value cannot hold: the row would be
// created and then throw on every GET, leaving a short code that only its delete_token can
// retire. Tab is stripped the same way but is legal in a header, so it is not rejected here.
test('URLs holding a character that is illegal in a Location header return 400', async () => {
  await withTestDb(async (db) => {
    for (const url of ['https://example.com/pa\nth', 'https://example.com/pa\rth', 'https://example.com/pa\0th']) {
      const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url } }))
      const body = await res.json<{ error: string }>()
      assert.equal(res.status, 400, `expected ${JSON.stringify(url)} to be rejected`)
      assert.match(body.error, /line break or control character/)
      assert.equal(await countRows(db), 0, `expected ${JSON.stringify(url)} to create no row`)
    }
  })
})

// A URL carrying userinfo (user:pass@host) clears every host-based check — the self-hostname
// and isPrivateHostname steps only see parsedUrl.hostname, so the credentials before the @ are
// invisible to them. target_url keeps the raw string, so those credentials would land verbatim
// in the Location header (and from there in logs and history), and https://trusted.example@evil
// is a classic @-confusion phishing form. Both must be rejected.
test('a URL carrying userinfo (username and/or password) returns 400 and stores no row', async () => {
  await withTestDb(async (db) => {
    for (const url of [
      'http://user:pass@example.com/',
      'http://user@example.com/',
      'https://accounts.example.com@evil.example/',
    ]) {
      const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url } }))
      const body = await res.json<{ error: string }>()
      assert.equal(res.status, 400, `expected ${JSON.stringify(url)} to be rejected`)
      assert.match(body.error, /username or password/)
      assert.equal(await countRows(db), 0, `expected ${JSON.stringify(url)} to create no row`)
    }
  })
})

// An @ after the host is part of the path, not userinfo — new URL() leaves username/password
// empty — so the check above must not touch it.
test('a URL with an @ in the path (not userinfo) is accepted', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'http://example.com/@notuserinfo' } }))
    assert.equal(res.status, 200)
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
    const { short_code, created_at } = await res.json<{ short_code: string; created_at: string }>()
    const link = await getLink(db, short_code)
    assert.equal(created_at, link.created_at)
  })
})

test('the response created_at is ISO 8601 with an explicit Z (UTC) marker', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
    const { created_at } = await res.json<{ created_at: string }>()
    assert.match(created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

test('the response created_at parses (as UTC) to a time close to now', async () => {
  await withTestDb(async (db) => {
    const before = Date.now()
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
    const after = Date.now()
    const { created_at } = await res.json<{ created_at: string }>()
    const parsed = new Date(created_at).getTime()
    assert.ok(parsed >= before - 1000 && parsed <= after + 1000, `expected ${parsed} to be within a second of [${before}, ${after}]`)
  })
})

test('the response short_code exists in the database with the matching target_url', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com/page' } }))
    const { short_code, target_url } = await res.json<{ short_code: string; target_url: string }>()
    const link = await getLink(db, short_code)
    assert.ok(link)
    assert.equal(target_url, 'https://example.com/page')
    assert.equal(link.target_url, 'https://example.com/page')
  })
})

test('the response delete_token matches the value stored in the database', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
    const { short_code, delete_token } = await res.json<{ short_code: string; delete_token: string }>()
    const link = await getLink(db, short_code)
    assert.equal(delete_token, link.delete_token)
  })
})

test('two consecutive requests get different delete_tokens', async () => {
  await withTestDb(async (db) => {
    const resA = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com/a' } }))
    const resB = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com/b' } }))
    const { delete_token: tokenA } = await resA.json<{ delete_token: string }>()
    const { delete_token: tokenB } = await resB.json<{ delete_token: string }>()
    assert.notEqual(tokenA, tokenB)
  })
})

test('a newly created row has deleted_at = null and clicks = 0', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }))
    const { short_code } = await res.json<{ short_code: string }>()
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

test('a colliding code from the generator is retried until a free one is found', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, 'EXIST1')
    let calls = 0
    const codeGenerator = () => {
      calls++
      return calls <= 2 ? 'EXIST1' : 'FRESH1'
    }

    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }), { codeGenerator })
    const body = await res.json<{ short_code: string }>()

    assert.equal(res.status, 200)
    assert.equal(body.short_code, 'FRESH1')
  })
})

// Verifies the retry loop is scoped to UNIQUE-constraint collisions only: a disk
// error must abort after the first attempt rather than burning all five.
test('a non-UNIQUE DB error is not retried and surfaces as 500', async (t) => {
  // The SQLITE_IOERR below is manufactured by this test, and shorten.ts logging it on the
  // 500 path is the behaviour we want in production. Silence it here only so the stack
  // trace does not appear in test output and read as a genuine failure. node:test restores
  // the mock when this test ends, so an unexpected console.error elsewhere is still visible.
  t.mock.method(console, 'error', () => {})

  let generatorCalls = 0
  const codeGenerator = () => {
    generatorCalls++
    return 'ANYCODE'
  }
  // Only the prepare().bind().run() path the handler takes is implemented, so it cannot satisfy
  // D1Database structurally — the assertion keeps createContext's contract honest for every
  // other caller instead of widening it to accommodate this one stub.
  const fakeDb = {
    prepare() {
      return {
        bind() {
          return this
        },
        async run() {
          throw new Error('SQLITE_IOERR: disk I/O error')
        },
      }
    },
  } as unknown as D1Database

  const res = await onRequestPost(createContext({ db: fakeDb, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }), {
    codeGenerator,
  })

  assert.equal(res.status, 500)
  assert.equal(generatorCalls, 1)
})

test('a syntactically valid but 2048+ character url returns 400', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(
      createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com/' + 'a'.repeat(3000) } }),
    )
    assert.equal(res.status, 400)
  })
})

test('a url pointing at this service\'s own domain returns 400', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.test/abc' } }))
    assert.equal(res.status, 400)
  })
})

test('isPrivateHostname returns true for private, loopback, link-local, and internal-suffixed hostnames', () => {
  const hostnames = [
    'localhost',
    'localhost.',
    '127.0.0.1',
    '10.0.0.5',
    '100.64.0.1',
    '0.0.0.0',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '[::1]',
    '[::ffff:7f00:1]',
    '[::ffff:0:0]',
    '[fd00::1]',
    '[fe80::1]',
    'foo.internal',
    'printer.local',
  ]
  for (const hostname of hostnames) {
    assert.equal(isPrivateHostname(hostname), true, `expected ${hostname} to be private`)
  }
})

test('isPrivateHostname returns false for public hostnames and addresses just outside the private ranges', () => {
  const hostnames = [
    '11.0.0.1',
    '100.63.0.1',
    '100.128.0.1',
    '128.0.0.1',
    '169.253.0.1',
    '172.15.0.1',
    '172.32.0.1',
    'notlocalhost.com',
    'internal.example.com',
    '10.0.0.1.example.com',
    'fc2.com',
    '[2001:db8::1]',
    '[fec0::1]',
    '[::ffff:808:808]',
    '[::ffff:1]',
  ]
  for (const hostname of hostnames) {
    assert.equal(isPrivateHostname(hostname), false, `expected ${hostname} to not be private`)
  }
})

test('POST /api/shorten rejects URLs whose normalized hostname points at a private address', async () => {
  await withTestDb(async (db) => {
    const urls = [
      'http://0177.0.0.1/',
      'http://2130706433/',
      'http://127.1/',
      'http://0/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://foo.internal/',
    ]
    for (const url of urls) {
      const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url } }))
      const body = await res.json<{ error: string }>()
      assert.equal(res.status, 400, `expected ${url} to be rejected`)
      assert.match(body.error, /private or local address/)
    }
  })
})

test('a request rejected for pointing at a private address inserts no row', async () => {
  await withTestDb(async (db) => {
    const before = await countRows(db)
    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'http://127.0.0.1/' } }))
    assert.equal(res.status, 400)
    assert.equal(await countRows(db), before)
  })
})

test('exhausting all collision retries returns 503 and inserts no row', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, 'EXIST1')
    const before = await countRows(db)
    const codeGenerator = () => 'EXIST1'

    const res = await onRequestPost(createContext({ db, method: 'POST', url: SHORTEN_URL, body: { url: 'https://example.com' } }), { codeGenerator })

    assert.equal(res.status, 503)
    assert.equal(await countRows(db), before)
  })
})
