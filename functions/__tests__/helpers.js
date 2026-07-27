import { Miniflare } from 'miniflare'
import { readFileSync } from 'node:fs'

const SCHEMA = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')

/**
 * Collapses schema.sql onto a single line for `d1 exec`, which rejects statements
 * spanning multiple lines. `--` comments must be stripped *before* the collapse:
 * otherwise everything after the first `--` becomes part of that comment, the whole
 * schema is swallowed, and d1 fails with "SQL code did not contain a statement" —
 * an error that points nowhere near the added comment that actually caused it.
 * Assumes `--` never appears inside a string literal, which holds for schema.sql.
 */
function flattenSchema(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter((line) => line !== '')
    .join(' ')
}

/** Returns a fresh, schema-applied D1 instance for a single test. */
export async function createTestDb() {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {}', // no Worker needed, only the D1 binding
    d1Databases: { DB: ':memory:' },
  })
  const db = await mf.getD1Database('DB')
  await db.exec(flattenSchema(SCHEMA))
  return { db, dispose: () => mf.dispose() }
}

/**
 * Runs `fn` against a fresh test DB and guarantees disposal via try/finally —
 * even if `fn` throws (e.g. a failing assertion), so the underlying Miniflare
 * process is never leaked. A leaked instance keeps a live child-process handle
 * open, which prevents the Node test process from exiting (it hangs instead of
 * finishing), rather than just failing the one test.
 */
export async function withTestDb(fn) {
  const { db, dispose } = await createTestDb()
  try {
    return await fn(db)
  } finally {
    await dispose()
  }
}

/** Assembles a Pages Functions context object. */
export function createContext({ db, method = 'GET', url = 'https://example.test/', body, rawBody, params = {} }) {
  const waitUntilTasks = []
  return {
    request: new Request(url, {
      method,
      // rawBody bypasses JSON.stringify — used to simulate a malformed request body.
      ...(rawBody !== undefined
        ? { body: rawBody, headers: { 'Content-Type': 'application/json' } }
        : body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    }),
    env: { DB: db },
    params,
    waitUntil: (p) => waitUntilTasks.push(p),
    // test-only: lets assertions wait for background tasks to finish
    _settle: () => Promise.all(waitUntilTasks),
  }
}
