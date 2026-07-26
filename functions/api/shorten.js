// Generates a random short code
function generateCode(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { url } = await request.json();

    // Basic check: is this a valid http/https URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return Response.json({ error: "Please provide a valid URL starting with http:// or https://" }, { status: 400 });
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return Response.json({ error: "Please provide a valid URL starting with http:// or https://" }, { status: 400 });
    }

    // Generate a unique short code
    let code;
    for (let attempt = 0; attempt < 5; attempt++) {
      code = generateCode();
      const existing = await env.DB.prepare(
        "SELECT short_code FROM links WHERE short_code = ?"
      ).bind(code).first();
      if (!existing) break; // no collision, use this one
    }

    // Generate the delete token, only ever returned in this response
    const deleteToken = crypto.randomUUID();
    // Explicitly generate the timestamp and store it, so the response matches the database record (server is the source of truth)
    const createdAt = new Date().toISOString();

    // Save to the database
    await env.DB.prepare(
      "INSERT INTO links (short_code, target_url, delete_token, created_at) VALUES (?, ?, ?, ?)"
    ).bind(code, url, deleteToken, createdAt).run();

    return Response.json({ short_code: code, target_url: url, delete_token: deleteToken, created_at: createdAt });
  } catch (err) {
    return Response.json({ error: "Server error: " + err.message }, { status: 500 });
  }
}
