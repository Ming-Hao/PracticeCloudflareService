export async function onRequestGet(context) {
  const { params, env } = context;
  const code = params.code;
  const link = await env.DB.prepare(
    "SELECT target_url FROM links WHERE short_code = ?"
  ).bind(code).first();
  if (!link) {
    return new Response("找不到這個短網址", { status: 404 });
  }
  await env.DB.prepare(
    "UPDATE links SET clicks = clicks + 1 WHERE short_code = ?"
  ).bind(code).run();
  return Response.redirect(link.target_url, 302);
}
