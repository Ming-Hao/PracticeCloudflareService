import { Miniflare } from 'miniflare'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// `new URL()` resolves to the Workers URL here (worker-configuration.d.ts), and node:fs only
// accepts the node:url one — the two declarations disagree on their iterator types, so the
// object cannot cross this boundary. Its href can: fileURLToPath takes a string too.
const SCHEMA = readFileSync(fileURLToPath(new URL('../../schema.sql', import.meta.url).href), 'utf8')

/**
 * Collapses schema.sql onto a single line for `d1 exec`, which rejects statements
 * spanning multiple lines. `--` comments must be stripped *before* the collapse:
 * otherwise everything after the first `--` becomes part of that comment, the whole
 * schema is swallowed, and d1 fails with "SQL code did not contain a statement" —
 * an error that points nowhere near the added comment that actually caused it.
 * Assumes `--` never appears inside a string literal, which holds for schema.sql.
 */
function flattenSchema(sql: string) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter((line) => line !== '')
    .join(' ')
}

/** Returns a fresh, schema-applied D1 instance for a single test. */
export async function createTestDb(): Promise<{ db: D1Database; dispose: () => Promise<void> }> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {}', // no Worker needed, only the D1 binding
    d1Databases: { DB: ':memory:' },
  })
  // miniflare types D1 via @cloudflare/workers-types, which this project does not install —
  // that import resolves to `any` under skipLibCheck, and without this the `any` would spread
  // through withTestDb into every db.prepare() call in the tests, switching their checking off.
  const db = (await mf.getD1Database('DB')) as unknown as D1Database
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
export async function withTestDb<T>(fn: (db: D1Database) => Promise<T>): Promise<T> {
  const { db, dispose } = await createTestDb()
  try {
    return await fn(db)
  } finally {
    await dispose()
  }
}

/**
 * The context a handler is called with in tests. `_settle` is test-only, so this can never
 * be a plain EventContext — hence the assertion in createContext rather than stubbing the
 * members (next, data, passThroughOnException, functionPath, env.ASSETS) a handler never
 * touches: filling those in would change the runtime shape the handlers actually see.
 */
type TestContext = EventContext<Env, string, unknown> & { _settle: () => Promise<unknown[]> }

/** Assembles a Pages Functions context object. */
export function createContext({
  db,
  method = 'GET',
  url = 'https://example.test/',
  body,
  rawBody,
  headers,
  params = {},
}: {
  db: D1Database
  method?: string
  url?: string
  body?: unknown
  rawBody?: string
  // Overrides the default `Content-Type: application/json` sent with a body — pass `{}` to
  // send no Content-Type at all. Omit it to keep the JSON default every other caller relies on.
  headers?: Record<string, string>
  params?: Record<string, string>
}): TestContext {
  const waitUntilTasks: Promise<unknown>[] = []
  return {
    request: new Request(url, {
      method,
      // rawBody bypasses JSON.stringify — used to simulate a malformed request body.
      ...(rawBody !== undefined
        ? { body: rawBody, headers: headers ?? { 'Content-Type': 'application/json' } }
        : body === undefined
          ? headers === undefined
            ? {}
            : { headers }
          : { body: JSON.stringify(body), headers: headers ?? { 'Content-Type': 'application/json' } }),
    }),
    env: { DB: db },
    params,
    waitUntil: (p: Promise<unknown>) => waitUntilTasks.push(p),
    // test-only: lets assertions wait for background tasks to finish
    _settle: () => Promise.all(waitUntilTasks),
  } as unknown as TestContext
}
