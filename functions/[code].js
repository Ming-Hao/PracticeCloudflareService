export async function onRequestGet(context) {
  const { params, env } = context;
  const code = params.code;
  const link = await env.DB.prepare(
    "SELECT target_url FROM links WHERE short_code = ? AND deleted_at IS NULL"
  ).bind(code).first();
  if (!link) {
    return Response.json({ error: "Short link not found" }, { status: 404 });
  }
  // Counting a click must not delay the redirect, so it runs after the response is sent
  context.waitUntil(
    env.DB.prepare(
      "UPDATE links SET clicks = clicks + 1 WHERE short_code = ?"
    ).bind(code).run()
  );
  // Built by hand rather than with Response.redirect(), whose headers are immutable and so
  // cannot take Cache-Control. Without no-store a cached 302 would keep sending visitors to
  // the old target after the link is edited or deleted, and stop the click counter entirely.
  return new Response(null, {
    status: 302,
    headers: { Location: link.target_url, "Cache-Control": "no-store" },
  });
}

export async function onRequestDelete(context) {
  const { params, env, request } = context;
  const code = params.code;

  let deleteToken;
  try {
    ({ delete_token: deleteToken } = await request.json());
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const link = await env.DB.prepare(
    "SELECT delete_token, deleted_at FROM links WHERE short_code = ?"
  ).bind(code).first();

  if (!link) {
    return Response.json({ error: "Short link not found" }, { status: 404 });
  }
  if (link.delete_token !== deleteToken) {
    return Response.json({ error: "Delete token mismatch" }, { status: 403 });
  }
  if (link.deleted_at) {
    // Already soft-deleted — treat as idempotent success
    return Response.json({ short_code: code });
  }

  await env.DB.prepare(
    "UPDATE links SET deleted_at = CURRENT_TIMESTAMP WHERE short_code = ?"
  ).bind(code).run();

  return Response.json({ short_code: code });
}
