import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withTestDb, createContext } from './helpers.ts'
import { onRequestGet, onRequestHead, onRequestDelete } from '../[code].ts'

type LinkRow = {
  short_code: string
  target_url: string
  delete_token: string
  deleted_at: string | null
  clicks: number
}

async function insertLink(
  db: D1Database,
  {
    short_code,
    target_url = 'https://example.com',
    delete_token = 'token-abc',
    deleted_at = null,
  }: { short_code: string; target_url?: string; delete_token?: string | null; deleted_at?: string | null },
) {
  await db
    .prepare('INSERT INTO links (short_code, target_url, delete_token, deleted_at) VALUES (?, ?, ?, ?)')
    .bind(short_code, target_url, delete_token, deleted_at)
    .run()
}

// Declared as always returning a row: every caller has just inserted the code it asks for, so a
// null here is a broken test rather than a case to handle, and it would already throw today.
async function getLink(db: D1Database, short_code: string) {
  return (await db.prepare('SELECT * FROM links WHERE short_code = ?').bind(short_code).first<LinkRow>())!
}

test('GET /:code — existing short code redirects with 302 to target_url', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', target_url: 'https://example.com/page' })

    const ctx = createContext({ db, params: { code: 'AAAAAA' } })
    const res = await onRequestGet(ctx)
    // The click counter runs via waitUntil; let it finish before withTestDb disposes the DB
    await ctx._settle()

    assert.equal(res.status, 302)
    assert.equal(res.headers.get('Location'), 'https://example.com/page')
  })
})

test('GET /:code — nonexistent short code returns 404', async () => {
  await withTestDb(async (db) => {
    const ctx = createContext({ db, params: { code: 'NOPE00' } })
    const res = await onRequestGet(ctx)

    assert.equal(res.status, 404)
  })
})

test('GET /:code — soft-deleted short code returns 404', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', deleted_at: '2026-01-01 00:00:00' })

    const ctx = createContext({ db, params: { code: 'AAAAAA' } })
    const res = await onRequestGet(ctx)

    assert.equal(res.status, 404)
  })
})

test('GET /:code — a successful redirect increments clicks by 1', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA' })

    const ctx = createContext({ db, params: { code: 'AAAAAA' } })
    await onRequestGet(ctx)
    await ctx._settle()

    const link = await getLink(db, 'AAAAAA')
    assert.equal(link.clicks, 1)
  })
})

// Uses a soft-deleted link rather than a nonexistent code: the row has to exist for
// `clicks` to be observable at all, otherwise the assertion passes vacuously no matter
// what the 404 path does to the counter.
test('GET /:code — a 404 on a soft-deleted link does not increment clicks', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', deleted_at: '2026-01-01 00:00:00' })

    const ctx = createContext({ db, params: { code: 'AAAAAA' } })
    const res = await onRequestGet(ctx)
    await ctx._settle()

    assert.equal(res.status, 404)
    const link = await getLink(db, 'AAAAAA')
    assert.equal(link.clicks, 0)
  })
})

test('HEAD /:code — existing short code returns 200', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA' })

    const ctx = createContext({ db, method: 'HEAD', params: { code: 'AAAAAA' } })
    const res = await onRequestHead(ctx)

    // Not cosmetic, and not a candidate for mirroring GET's 302: resolveLinkClick probes
    // with fetch's default redirect: 'follow', so a 302 here gets followed cross-origin to
    // the target site and fails CORS. If you change this, add redirect: 'manual' back to
    // src/utils/linkClick.ts in the same change.
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Location'), null)
  })
})

test('HEAD /:code — nonexistent short code returns 404', async () => {
  await withTestDb(async (db) => {
    const ctx = createContext({ db, method: 'HEAD', params: { code: 'NOPE00' } })
    const res = await onRequestHead(ctx)

    assert.equal(res.status, 404)
  })
})

test('HEAD /:code — soft-deleted short code returns 404', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', deleted_at: '2026-01-01 00:00:00' })

    const ctx = createContext({ db, method: 'HEAD', params: { code: 'AAAAAA' } })
    const res = await onRequestHead(ctx)

    assert.equal(res.status, 404)
  })
})

test('HEAD /:code — a hit does not increment clicks', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA' })

    const ctx = createContext({ db, method: 'HEAD', params: { code: 'AAAAAA' } })
    await onRequestHead(ctx)

    const link = await getLink(db, 'AAAAAA')
    assert.equal(link.clicks, 0)
  })
})

test('DELETE /:code — correct token deletes: 200 and deleted_at is set', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', delete_token: 'correct-token' })

    const ctx = createContext({ db, method: 'DELETE', params: { code: 'AAAAAA' }, body: { delete_token: 'correct-token' } })
    const res = await onRequestDelete(ctx)

    assert.equal(res.status, 200)
    const link = await getLink(db, 'AAAAAA')
    assert.notEqual(link.deleted_at, null)
    // Same ISO 8601 shape as created_at, not SQLite's CURRENT_TIMESTAMP format
    assert.match(link.deleted_at!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

test('DELETE /:code — wrong token: 403 and deleted_at stays null', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', delete_token: 'correct-token' })

    const ctx = createContext({ db, method: 'DELETE', params: { code: 'AAAAAA' }, body: { delete_token: 'wrong-token' } })
    const res = await onRequestDelete(ctx)

    assert.equal(res.status, 403)
    const link = await getLink(db, 'AAAAAA')
    assert.equal(link.deleted_at, null)
  })
})

test('DELETE /:code — nonexistent short code returns 404', async () => {
  await withTestDb(async (db) => {
    const ctx = createContext({ db, method: 'DELETE', params: { code: 'NOPE00' }, body: { delete_token: 'anything' } })
    const res = await onRequestDelete(ctx)

    assert.equal(res.status, 404)
  })
})

test('DELETE /:code — re-deleting an already soft-deleted link with the correct token is idempotent (200)', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', delete_token: 'correct-token', deleted_at: '2026-01-01 00:00:00' })

    const ctx = createContext({ db, method: 'DELETE', params: { code: 'AAAAAA' }, body: { delete_token: 'correct-token' } })
    const res = await onRequestDelete(ctx)

    assert.equal(res.status, 200)
  })
})

test('DELETE /:code — malformed JSON body returns 400', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', delete_token: 'correct-token' })

    const ctx = createContext({ db, method: 'DELETE', params: { code: 'AAAAAA' }, rawBody: '{not valid json' })
    const res = await onRequestDelete(ctx)

    assert.equal(res.status, 400)
  })
})

test('DELETE /:code — missing delete_token field returns 403 (undefined matches no token)', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', delete_token: 'correct-token' })

    const ctx = createContext({ db, method: 'DELETE', params: { code: 'AAAAAA' }, body: {} })
    const res = await onRequestDelete(ctx)

    assert.equal(res.status, 403)
  })
})

// `delete_token` was added by ALTER TABLE, so every row predating it holds NULL, and the column
// has no NOT NULL constraint to stop more appearing. A plain `!==` reads those rows as null and
// matches a request that sends null, which is why the handler tests the type before comparing.
test('DELETE /:code — row with a NULL delete_token rejects a null token: 403 and deleted_at stays null', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', delete_token: null })

    const ctx = createContext({ db, method: 'DELETE', params: { code: 'AAAAAA' }, body: { delete_token: null } })
    const res = await onRequestDelete(ctx)

    assert.equal(res.status, 403)
    const link = await getLink(db, 'AAAAAA')
    assert.equal(link.deleted_at, null)
  })
})

test('DELETE /:code — row with a NULL delete_token rejects a missing token: 403', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', delete_token: null })

    const ctx = createContext({ db, method: 'DELETE', params: { code: 'AAAAAA' }, body: {} })
    const res = await onRequestDelete(ctx)

    assert.equal(res.status, 403)
  })
})

test('GET /:code — a successful redirect includes Cache-Control: no-store', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA' })

    const ctx = createContext({ db, params: { code: 'AAAAAA' } })
    const res = await onRequestGet(ctx)
    await ctx._settle()

    assert.equal(res.headers.get('Cache-Control'), 'no-store')
  })
})

// Not a header the redirect itself obeys — it retargets the *next* request. Fetch's
// HTTP-redirect step re-reads the referrer policy from the redirect response, so this is
// what keeps the target site from seeing which shortener sent the visitor. Dropping it
// silently restores the default policy and leaks this deployment's origin.
test('GET /:code — a successful redirect includes Referrer-Policy: no-referrer', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA' })

    const ctx = createContext({ db, params: { code: 'AAAAAA' } })
    const res = await onRequestGet(ctx)
    await ctx._settle()

    assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer')
  })
})

// Covers both DELETE error branches at once: fixing one would otherwise turn this test green
// while the other stayed plain text. The 403 branch is the one code review flagged as the
// future `await res.json()` trap.
//
// GET 404 used to be asserted here as a third case. It no longer is, and that is the point of
// the split rather than an omission: the JSON contract exists because the frontend calls
// `await res.json()` on these responses, and nothing calls GET /:code that way — a visitor
// arrives by navigation, so that branch answers with a page (see the test below).
test('DELETE /:code — error responses are JSON, not plain text', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', delete_token: 'correct-token' })

    const cases = [
      { label: 'DELETE 404', ctx: createContext({ db, method: 'DELETE', params: { code: 'NOPE00' }, body: { delete_token: 'anything' } }) },
      { label: 'DELETE 403', ctx: createContext({ db, method: 'DELETE', params: { code: 'AAAAAA' }, body: { delete_token: 'wrong-token' } }) },
    ]
    for (const { label, ctx } of cases) {
      const res = await onRequestDelete(ctx)
      assert.match(res.headers.get('Content-Type') ?? '', /application\/json/, `${label} should respond with JSON`)
      const body = await res.json<{ error: string }>()
      assert.equal(typeof body.error, 'string', `${label} should carry an error string`)
    }
  })
})

// The 404 a human actually reads. Asserting the way home rather than the wording: the copy is
// free to change, but a dead end with no route back to the site is the failure this pins.
test('GET /:code — the 404 is a readable HTML page linking back to the site', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestGet(createContext({ db, params: { code: 'NOPE00' } }))
    const body = await res.text()

    assert.equal(res.status, 404)
    assert.match(res.headers.get('Content-Type') ?? '', /text\/html/)
    assert.match(body, /^<!doctype html>/i)
    assert.match(body, /<html lang="en">/)
    assert.match(body, /href="\/"/)
  })
})

// Same reasoning as the 302's no-store, and it matters for the same reason. A short code that
// 404s today has not been taken yet — `short_code` is UNIQUE, so a soft-deleted one can never
// be reissued, but one that never existed can be handed out tomorrow. A cached 404 would then
// keep answering for a link that is live.
test('GET /:code — the 404 is not cacheable', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestGet(createContext({ db, params: { code: 'NOPE00' } }))

    assert.equal(res.headers.get('Cache-Control'), 'no-store')
  })
})

// `public/_headers` reaches static responses only, so this page — assembled in code — starts
// with none of it. Reconstructing the full CSP here buys nothing on a page with no script and
// no form, but these two cost one header each, and leaving them off makes a deliberate gap
// look like an oversight.
test('GET /:code — the 404 page sets the headers `_headers` cannot reach', async () => {
  await withTestDb(async (db) => {
    const res = await onRequestGet(createContext({ db, params: { code: 'NOPE00' } }))

    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(res.headers.get('X-Frame-Options'), 'DENY')
  })
})

// A database that faults on every read, standing in for D1 being transiently unavailable.
// Only the prepare().bind().first() path these three handlers take is implemented, so it
// cannot satisfy D1Database structurally — the assertion keeps createContext's contract
// honest for every other caller instead of widening it to accommodate this one stub.
const failingDb = {
  prepare() {
    return {
      bind() {
        return this
      },
      async first() {
        throw new Error('D1_ERROR: no such table: links')
      },
    }
  },
} as unknown as D1Database

// Without a catch the rejection escapes the handler, and what a visitor gets is the platform's
// own error page rather than anything this project wrote. These three pin that each entrypoint
// answers in the shape its caller already expects: a page for the human, a bare status for the
// probe, JSON for the script.
test('GET /:code — a database fault answers with a readable 500 page', async (t) => {
  // The fault below is manufactured here, and the handler logging it is the behaviour we want
  // in production. Silenced so the stack trace does not read as a genuine test failure.
  t.mock.method(console, 'error', () => {})

  const res = await onRequestGet(createContext({ db: failingDb, params: { code: 'AAAAAA' } }))
  const body = await res.text()

  assert.equal(res.status, 500)
  assert.match(res.headers.get('Content-Type') ?? '', /text\/html/)
  assert.match(body, /^<!doctype html>/i)
  assert.match(body, /href="\/"/)
})

// Same reasoning as the 404's no-store, and more pressing: a fault is by definition temporary,
// so a cached 500 would outlive the outage that produced it.
test('GET /:code — the 500 page is not cacheable and sets the headers `_headers` cannot reach', async (t) => {
  t.mock.method(console, 'error', () => {})

  const res = await onRequestGet(createContext({ db: failingDb, params: { code: 'AAAAAA' } }))

  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(res.headers.get('X-Frame-Options'), 'DENY')
})

// 500 rather than 404 is what makes this useful: `resolveLinkClick` treats only a 404 as a dead
// link, so a fault here navigates instead of telling the user their link is gone.
test('HEAD /:code — a database fault returns 500 with no body', async (t) => {
  t.mock.method(console, 'error', () => {})

  const res = await onRequestHead(createContext({ db: failingDb, params: { code: 'AAAAAA' } }))

  assert.equal(res.status, 500)
  assert.equal(await res.text(), '')
})

test('DELETE /:code — a database fault returns 500 as JSON', async (t) => {
  t.mock.method(console, 'error', () => {})

  const res = await onRequestDelete(
    createContext({ db: failingDb, method: 'DELETE', params: { code: 'AAAAAA' }, body: { delete_token: 'token-abc' } }),
  )

  assert.equal(res.status, 500)
  assert.match(res.headers.get('Content-Type') ?? '', /application\/json/)
  const body = await res.json<{ error: string }>()
  assert.equal(typeof body.error, 'string')
})
