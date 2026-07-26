export async function onRequestGet(context) {
  const { params, env } = context;
  const code = params.code;
  const link = await env.DB.prepare(
    "SELECT target_url FROM links WHERE short_code = ? AND deleted_at IS NULL"
  ).bind(code).first();
  if (!link) {
    return new Response("找不到這個短網址", { status: 404 });
  }
  await env.DB.prepare(
    "UPDATE links SET clicks = clicks + 1 WHERE short_code = ?"
  ).bind(code).run();
  return Response.redirect(link.target_url, 302);
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
    return new Response("Short link not found", { status: 404 });
  }
  if (link.delete_token !== deleteToken) {
    return new Response("Delete token mismatch", { status: 403 });
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
