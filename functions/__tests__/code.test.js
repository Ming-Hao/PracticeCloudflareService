import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withTestDb, createContext } from './helpers.js'
import { onRequestGet, onRequestDelete } from '../[code].js'

async function insertLink(db, { short_code, target_url = 'https://example.com', delete_token = 'token-abc', deleted_at = null }) {
  await db
    .prepare('INSERT INTO links (short_code, target_url, delete_token, deleted_at) VALUES (?, ?, ?, ?)')
    .bind(short_code, target_url, delete_token, deleted_at)
    .run()
}

async function getLink(db, short_code) {
  return db.prepare('SELECT * FROM links WHERE short_code = ?').bind(short_code).first()
}

test('GET /:code — existing short code redirects with 302 to target_url', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA', target_url: 'https://example.com/page' })

    const ctx = createContext({ db, params: { code: 'AAAAAA' } })
    const res = await onRequestGet(ctx)

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

test('GET /:code — a 404 does not increment clicks', async () => {
  await withTestDb(async (db) => {
    const ctx = createContext({ db, params: { code: 'NOPE00' } })
    await onRequestGet(ctx)
    await ctx._settle()

    const link = await getLink(db, 'NOPE00')
    assert.equal(link, null)
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

// --- Red tests: these fail against the current implementation and are expected to
// stay red until the corresponding code-review fix lands. Do not "fix" these tests
// to make them pass — fix the handler instead. ---

test('[RED, P1-6] GET /:code — a successful redirect includes Cache-Control: no-store', async () => {
  await withTestDb(async (db) => {
    await insertLink(db, { short_code: 'AAAAAA' })

    const ctx = createContext({ db, params: { code: 'AAAAAA' } })
    const res = await onRequestGet(ctx)

    assert.equal(res.headers.get('Cache-Control'), 'no-store')
  })
})

test('[RED, P2-9] DELETE /:code — error responses are JSON, not plain text', async () => {
  await withTestDb(async (db) => {
    const ctx = createContext({ db, method: 'DELETE', params: { code: 'NOPE00' }, body: { delete_token: 'anything' } })
    const res = await onRequestDelete(ctx)

    assert.equal(res.headers.get('Content-Type'), 'application/json')
    const body = await res.json()
    assert.equal(typeof body.error, 'string')
  })
})
