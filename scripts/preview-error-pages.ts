// Renders the two error pages built inside functions/[code].ts to standalone HTML files,
// so their styling can be opened in a browser without running wrangler or breaking D1.
//
//   node scripts/preview-error-pages.ts            # writes mockups/error-404.html, error-500.html
//   node scripts/preview-error-pages.ts before     # writes error-404.before.html, ...
//   node scripts/preview-error-pages.ts --force    # overwrite without asking
//
// Output goes to mockups/, which is already gitignored. Each page is handled in turn — 404
// first, then 500 — and an existing file is named in its own prompt before being replaced,
// so answering never means agreeing to something further down the run.
//
// Neither page is exported, so both are reached through onRequestGet with a stub DB:
// one that finds nothing produces the 404, one that throws produces the 500. That means
// the bytes written here are the ones the handler actually returns, not a copy of the
// markup that could drift from it.
//
// Pass a tag to keep several runs side by side — `before` / `after` around a refactor,
// then `diff mockups/error-404.before.html mockups/error-404.after.html`.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { onRequestGet } from '../functions/[code].ts'

const args = process.argv.slice(2)
const force = args.includes('--force') || args.includes('-f')
const tag = args.find((arg) => !arg.startsWith('-'))
const suffix = tag ? `.${tag}` : ''
const outDir = new URL('../mockups/', import.meta.url).pathname

if (args.includes('--help') || args.includes('-h')) {
  console.log();
  console.log(`Usage: node scripts/preview-error-pages.ts [tag] [--force]

Writes the 404 and 500 pages that functions/[code].ts builds in code to mockups/
as standalone HTML files, so their styling can be opened in a browser without
running wrangler or breaking the local D1 database.

Both pages come from calling onRequestGet with a stub DB, so the bytes written
are the ones a visitor would receive — not a copy of the markup kept in step by
hand.

Arguments
  tag            Filename suffix. \`before\` writes error-404.before.html, so two
                 runs can sit side by side and be compared with diff.

Options
  -f, --force    Replace existing files without asking.
  -h, --help     Show this message.

Output
  mockups/error-404[.tag].html
  mockups/error-500[.tag].html

mockups/ is gitignored, and is created if it does not exist. Each page is handled
in turn — 404 first, then 500 — and an existing file is named in its own prompt
before being replaced, so answering never covers a file further down the run.`)
  console.log();
  process.exit(0)
}

// Only the prepare().bind().first() path onRequestGet takes is implemented — enough to
// steer it down each of its two error branches, and nothing more.
const missingRow = { prepare: () => ({ bind: () => ({ first: async () => null }) }) }
const failingDb = {
  prepare: () => ({
    bind: () => ({
      first: async () => {
        throw new Error('stub D1 failure')
      },
    }),
  }),
}

function context(db: unknown) {
  return {
    params: { code: 'AAAAAA' },
    env: { DB: db },
    request: new Request('http://localhost/AAAAAA'),
    // Only the 302 path reaches waitUntil, and neither stub gets that far.
    waitUntil: () => {},
  } as never
}

// Opened on the first question rather than up front: an interface over stdin keeps the
// event loop alive, so a run that asks nothing would otherwise hang at the end.
let rl: ReturnType<typeof createInterface> | undefined

async function confirmOverwrite(file: string): Promise<boolean> {
  console.log(`\n${file}\n  already exists.`)

  // Nothing can answer a prompt on a pipe, and a hung script is a worse failure than a
  // refusal that names the way past it.
  if (!process.stdin.isTTY) {
    console.log('  No terminal to ask. Re-run with --force to overwrite.')
    process.exit(1)
  }

  rl ??= createInterface({ input: process.stdin, output: process.stdout })

  let answer: string
  try {
    answer = await rl.question('  Overwrite it? [y/N] ')
  } catch {
    // Ctrl+D closes stdin mid-question, which readline reports by rejecting. That is a way
    // of declining, not a crash — without this it surfaces as an AbortError stack trace.
    console.log()
    return false
  }

  // Default to keeping the file: every answer that is not a clear yes leaves it alone.
  return /^y(es)?$/i.test(answer.trim())
}

// The 500 branch logs the stub failure by design; keep this script's own output readable.
console.error = () => {}

mkdirSync(outDir, { recursive: true })

const targets = [
  { label: '404', db: missingRow },
  { label: '500', db: failingDb },
].map((page) => ({ ...page, file: `${outDir}error-${page.label}${suffix}.html` }))

const written: string[] = []

// Sequential on purpose. Each page is decided and written before the next one is mentioned,
// so a prompt is only ever about the file named directly above it.
for (const { label, db, file } of targets) {
  if (existsSync(file) && !force && !(await confirmOverwrite(file))) {
    console.log(`  Kept. ${label} page not written.`)
    continue
  }

  const res = await onRequestGet(context(db))
  const body = await res.text()

  writeFileSync(file, body)
  written.push(file)

  const headers = [...res.headers]
    .sort()
    .map(([name, value]) => `  ${name}: ${value}`)
    .join('\n')
  console.log(`\n${file}\n  ${res.status}, ${body.length} bytes\n${headers}`)
}

rl?.close()

if (written.length === 0) {
  console.log('\nNothing written.')
} else {
  // Absolute paths, so the command works whatever directory the script was run from —
  // which makes it too long for one terminal line, hence the backslash continuations.
  console.log(`\nopen \\\n  ${written.join(' \\\n  ')}`)
}
