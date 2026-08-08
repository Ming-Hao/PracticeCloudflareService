// The shell both error pages share. They are the only responses here a person reads rather
// than a script: a visitor arrives by clicking a link, not by calling an API, so these
// branches answer with a page while the DELETE branches keep returning JSON for
// `await res.json()`.
//
// The CSS is inline because a Function response cannot reference the hashed bundle Vite emits,
// which also puts these pages outside the `public/_headers` CSP — that policy covers static
// responses only. Colours and the button are copied from src/assets/base.css and buttons.css;
// nothing imports them here, so editing those files will not update this page.
//
// Both headers below are set in code because a Function response never sees public/_headers.
// The CSP there is not repeated: these pages load nothing external and run no script, so it
// would only be ceremony. `no-store` is on both for reasons the two callers give.
interface ErrorPageOptions {
  status: number;
  title: string;
  heading: string;
  body: string;
}

// `heading` and `body` are interpolated raw. Both callers pass literals written here, and
// nothing from the request reaches this function — `params.code` is never shown. Keep it
// that way, or this becomes an injection point.
function errorPage({ status, title, heading, body }: ErrorPageOptions) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#181818">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
:root {
  color-scheme: dark;
  --color-background: #181818; --color-heading: #fff; --color-text-soft: rgba(235,235,235,.64);
}
body { margin: 0; min-height: 100vh; display: grid; align-content: start; justify-content: center;
  justify-items: center;
  gap: .75rem; padding: 10vh 2rem 2rem; text-align: center; line-height: 1.6; font-size: 15px;
  color: var(--color-text-soft); background: var(--color-background);
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased }
h1 { margin: 0; font-size: 2rem; line-height: 1.3; font-weight: 500; color: var(--color-heading) }
p { margin: 0 }
.btn-primary { display: inline-flex; align-items: center; gap: .4rem; margin-top: .75rem;
  padding: .5rem 1rem; border-radius: .4rem; font-size: 1rem; background: #1c8555; color: #fff;
  text-decoration: none; white-space: nowrap }
.btn-primary:hover { background: #19794c }
svg { width: 16px; height: 16px; flex-shrink: 0 }
</style>
</head>
<body>
<h1>${heading}</h1>
<p>${body}</p>
<a class="btn-primary" href="/">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
  </svg>
  Create a new short link
</a>
</body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    }
  );
}

// `no-store` for the same reason as the redirect below. A code that 404s today is simply
// unallocated — `short_code` is UNIQUE so a soft-deleted one is never reissued, but an unused
// one can be handed out tomorrow, and a cached 404 would outlive the link it denies.
function notFoundPage() {
  return errorPage({
    status: 404,
    title: "Link not found",
    heading: "This short link doesn't exist",
    body: "It was deleted, or the address was mistyped.",
  });
}

// The second page a person reads, for the case notFoundPage() cannot describe: the lookup
// never got an answer, so we do not know whether the link exists. The two say opposite things
// — one is a dead end, this one is "come back in a minute" — which is why they stay separate
// functions over a shared shell rather than one page with a swapped status.
//
// `no-store` matters more here than on the 404: a fault is by definition temporary, and a
// cached 500 would keep answering for a link that came back the moment the database did.
function serverErrorPage() {
  return errorPage({
    status: 500,
    title: "Something went wrong",
    heading: "Something went wrong",
    body: "This short link could not be looked up just now. Please try again in a moment.",
  });
}

// Params<'code'> types params.code as `string | string[]` because that is what a catch-all
// route would produce. `[code]` is a single dynamic segment, so the array form never occurs
// here — the assertion below states that, it does not check it.
export async function onRequestGet(
  context: EventContext<Env, "code", unknown>
): Promise<Response> {
  const { params, env } = context;
  const code = params.code as string;
  try {
    const link = await env.DB.prepare(
      "SELECT target_url FROM links WHERE short_code = ? AND deleted_at IS NULL"
    ).bind(code).first<{ target_url: string }>();
    if (!link) {
      return notFoundPage();
    }
    // Counting a click must not delay the redirect, so it runs after the response is sent.
    // Its own failure is not caught here: waitUntil resolves after this handler returns, so a
    // rejection cannot change the response that already went out.
    context.waitUntil(
      env.DB.prepare(
        "UPDATE links SET clicks = clicks + 1 WHERE short_code = ?"
      ).bind(code).run()
    );
    // Built by hand rather than with Response.redirect(), whose headers are immutable — which
    // rules out both headers below, not just the first. Without no-store a cached 302 would keep
    // sending visitors to the old target after the link is edited or deleted, and stop the click
    // counter entirely. no-referrer applies to the request the browser makes next, not to this
    // response: fetch re-reads the referrer policy from a redirect, so without it the target site
    // is told which shortener sent the visitor.
    return new Response(null, {
      status: 302,
      headers: {
        Location: link.target_url,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (err) {
    // Uncaught, this rejection is answered by the platform's own error page instead of anything
    // this project wrote — the visitor loses both the styling and the way back to the site.
    console.error("GET /:code failed:", err);
    return serverErrorPage();
  }
}

// Lets the frontend check whether a short code is still live before navigating,
// without counting that check as a click — only onRequestGet does that.
export async function onRequestHead(
  context: EventContext<Env, "code", unknown>
): Promise<Response> {
  const { params, env } = context;
  const code = params.code as string;
  try {
    const link = await env.DB.prepare(
      "SELECT short_code FROM links WHERE short_code = ? AND deleted_at IS NULL"
    ).bind(code).first<{ short_code: string }>();
    if (!link) {
      return new Response(null, { status: 404 });
    }
    return new Response(null, { status: 200 });
  } catch (err) {
    // 500 rather than 404 is the whole point of catching here: resolveLinkClick treats only a
    // 404 as a dead link, so a fault navigates instead of telling the user their link is gone.
    console.error("HEAD /:code failed:", err);
    return new Response(null, { status: 500 });
  }
}

export async function onRequestDelete(
  context: EventContext<Env, "code", unknown>
): Promise<Response> {
  const { params, env, request } = context;
  const code = params.code as string;

  let deleteToken: unknown;
  try {
    // The type argument describes the body this handler hopes for; the request can still send
    // anything, which is why the comparison below stays a plain !== against whatever arrived.
    ({ delete_token: deleteToken } = await request.json<{ delete_token?: unknown }>());
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Starts below the body parsing above, which already answers its own failure with a 400.
  // Wrapping that too would leave the two indistinguishable, and a malformed body is the
  // client's fault rather than a fault to report as 500.
  try {
    const link = await env.DB.prepare(
      "SELECT delete_token, deleted_at FROM links WHERE short_code = ?"
    ).bind(code).first<{ delete_token: string | null; deleted_at: string | null }>();

    if (!link) {
      return Response.json({ error: "Short link not found" }, { status: 404 });
    }
    // The typeof guard is not redundant with the comparison: `delete_token` arrived by ALTER TABLE
    // and carries no NOT NULL constraint, so rows predating it hold NULL, which `!==` reads as null
    // and a request body of `{"delete_token": null}` matches — deleting someone else's link without
    // the token. Both sides have to be a string before comparing them means anything.
    if (typeof deleteToken !== "string" || link.delete_token !== deleteToken) {
      return Response.json({ error: "Delete token mismatch" }, { status: 403 });
    }
    if (link.deleted_at) {
      // Already soft-deleted — treat as idempotent success
      return Response.json({ short_code: code });
    }

    // ISO 8601 with an explicit Z, matching how created_at is written in api/shorten.ts —
    // SQLite's CURRENT_TIMESTAMP has no timezone marker and reads as local time.
    await env.DB.prepare(
      "UPDATE links SET deleted_at = ? WHERE short_code = ?"
    ).bind(new Date().toISOString(), code).run();

    return Response.json({ short_code: code });
  } catch (err) {
    // JSON, not a page: this branch is reached by the frontend's fetch, which reads res.json().
    console.error("DELETE /:code failed:", err);
    return Response.json({ error: "Something went wrong, please try again" }, { status: 500 });
  }
}
