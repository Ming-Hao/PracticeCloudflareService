// Manual diagnostic script — NOT picked up by `node --test` (filename doesn't match
// the *.test.js pattern). Run directly with `node functions/__tests__/verify-status.js`
// to check what status code a handler actually returns for a given input, before
// writing an assertion around it (useful for confirming whether a scenario is
// currently green or red ahead of writing a characterization/red test).
import { createTestDb, createContext } from './helpers.js'
import { onRequestPost } from '../api/shorten.js'

const cases = [
  {
    label: '1.5 malformed JSON body',
    expected: 400,
    run: (db) => createContext({ db, method: 'POST', url: 'https://example.test/api/shorten', rawBody: '{not json' }),
  },
  {
    label: '1.6 non-string url ({"url": 123})',
    expected: 400,
    run: (db) => createContext({ db, method: 'POST', url: 'https://example.test/api/shorten', body: { url: 123 } }),
  },
  {
    label: '1.7 missing url ({})',
    expected: 400,
    run: (db) => createContext({ db, method: 'POST', url: 'https://example.test/api/shorten', body: {} }),
  },
  {
    label: '1.8 syntactically valid but 3000+ char url',
    expected: 400,
    run: (db) =>
      createContext({
        db,
        method: 'POST',
        url: 'https://example.test/api/shorten',
        body: { url: 'https://example.com/' + 'a'.repeat(3000) },
      }),
  },
  {
    label: '1.9 url pointing at this service\'s own domain',
    expected: 400,
    run: (db) => createContext({ db, method: 'POST', url: 'https://example.test/api/shorten', body: { url: 'https://example.test/abc' } }),
  },
]

for (const { label, expected, run } of cases) {
  const { db, dispose } = await createTestDb()
  const res = await onRequestPost(run(db))
  const bodyText = await res.clone().text()
  const match = res.status === expected
  const mark = match ? '✓ already matches' : '✗ MISMATCH'
  console.log(`${label}`)
  console.log(`  expected: ${expected}   actual: ${res.status}   ${mark}`)
  console.log(`  body: ${bodyText}\n`)
  await dispose()
}

// --- Custom checks that need more than a status comparison (collision retry, INSERT
// error classification) go here, each printing its own expected-vs-actual summary. ---

async function insertLink(db, short_code, target_url = 'https://example.com') {
  await db.prepare('INSERT INTO links (short_code, target_url, delete_token) VALUES (?, ?, ?)').bind(short_code, target_url, 'x').run()
}

async function countRows(db) {
  const { count } = await db.prepare('SELECT COUNT(*) as count FROM links').first()
  return count
}

// 1.15 — generator returns a colliding code twice, then a fresh one on the 3rd call.
{
  const { db, dispose } = await createTestDb()
  await insertLink(db, 'EXIST1')
  let calls = 0
  const codeGenerator = () => {
    calls++
    return calls <= 2 ? 'EXIST1' : 'FRESH1'
  }
  const res = await onRequestPost(
    createContext({ db, method: 'POST', url: 'https://example.test/api/shorten', body: { url: 'https://example.com/x' } }),
    { codeGenerator },
  )
  const body = await res.clone().text()
  console.log('1.15 collision then success on 3rd attempt')
  console.log(`  expected: 200 using FRESH1   actual status: ${res.status}   body: ${body}\n`)
  await dispose()
}

// 1.16 — generator always returns a colliding code → should be 503, no new row inserted.
{
  const { db, dispose } = await createTestDb()
  await insertLink(db, 'EXIST1')
  const before = await countRows(db)
  const codeGenerator = () => 'EXIST1'
  const res = await onRequestPost(
    createContext({ db, method: 'POST', url: 'https://example.test/api/shorten', body: { url: 'https://example.com/x' } }),
    { codeGenerator },
  )
  const after = await countRows(db)
  const body = await res.clone().text()
  const match = res.status === 503 && after === before
  console.log('1.16 exhausted retries (always-colliding generator)')
  console.log(`  expected: 503, row count unchanged (${before})   actual: status ${res.status}, row count ${after}   ${match ? '✓' : '✗ MISMATCH'}`)
  console.log(`  body: ${body}\n`)
  await dispose()
}

// 1.17 — a non-UNIQUE DB error should propagate as 500 without retrying.
// Simulated with a fake env.DB whose .run() always throws a non-UNIQUE error, so we can
// also count how many times the generator (and therefore the insert attempt) ran.
{
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
  const ctx = createContext({ db: fakeDb, method: 'POST', url: 'https://example.test/api/shorten', body: { url: 'https://example.com/x' } })
  const res = await onRequestPost(ctx, { codeGenerator })
  const body = await res.clone().text()
  const match = res.status === 500 && generatorCalls === 1
  console.log('1.17 non-UNIQUE DB error does not retry')
  console.log(`  expected: 500, generator called once   actual: status ${res.status}, generator called ${generatorCalls}x   ${match ? '✓' : '✗ MISMATCH'}`)
  console.log(`  body: ${body}\n`)
}

// 1.20 — character frequency across 10,000 generated codes should be roughly uniform.
{
  const { generateCode } = await import('../api/shorten.js')
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const counts = new Map(Array.from(alphabet, (c) => [c, 0]))
  const totalChars = 10_000 * 6
  for (let i = 0; i < 10_000; i++) {
    for (const c of generateCode()) counts.set(c, counts.get(c) + 1)
  }
  const expected = totalChars / alphabet.length
  const low = expected * 0.8
  const high = expected * 1.2
  const outliers = [...counts.entries()].filter(([, n]) => n < low || n > high)
  console.log('1.20 character frequency within ±20% of expected across 10,000 codes')
  console.log(`  expected per char: ~${expected.toFixed(1)} (range ${low.toFixed(1)}-${high.toFixed(1)})`)
  console.log(`  outliers: ${outliers.length === 0 ? 'none ✓' : outliers.map(([c, n]) => `${c}=${n}`).join(', ') + ' ✗ MISMATCH'}\n`)
}
