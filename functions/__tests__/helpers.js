import { Miniflare } from 'miniflare'
import { readFileSync } from 'node:fs'

const SCHEMA = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')

/** Returns a fresh, schema-applied D1 instance for a single test. */
export async function createTestDb() {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {}', // no Worker needed, only the D1 binding
    d1Databases: { DB: ':memory:' },
  })
  const db = await mf.getD1Database('DB')
  await db.exec(SCHEMA.replace(/\n/g, ' ')) // d1 exec rejects multi-line statements
  return { db, dispose: () => mf.dispose() }
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
