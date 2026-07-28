// Matches the de facto browser address bar limit, so a shortened link stays usable everywhere
const MAX_URL_LENGTH = 2048;

// Generates a random short code
export function generateCode(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function onRequestPost(context, { codeGenerator = generateCode } = {}) {
  const { request, env } = context;

  let url;
  try {
    ({ url } = await request.json());
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    // Basic check: is this a valid http/https URL
    // Reject non-strings explicitly rather than relying on `new URL(123)` happening to throw
    if (typeof url !== "string") {
      return Response.json({ error: "Please provide a valid URL starting with http:// or https://" }, { status: 400 });
    }
    // Cap the length before parsing, so an oversized input is never handed to the URL parser or the database
    if (url.length > MAX_URL_LENGTH) {
      return Response.json({ error: `URL must be at most ${MAX_URL_LENGTH} characters` }, { status: 400 });
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return Response.json({ error: "Please provide a valid URL starting with http:// or https://" }, { status: 400 });
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return Response.json({ error: "Please provide a valid URL starting with http:// or https://" }, { status: 400 });
    }
    // Refuse to shorten links pointing back at this service, which would redirect to itself.
    // Partial protection only: this compares against the hostname the request came in on, so a
    // deployment reachable under several hostnames (e.g. *.pages.dev plus a custom domain) can
    // still shorten a link aimed at one of its other hostnames.
    if (parsedUrl.hostname === new URL(request.url).hostname) {
      return Response.json({ error: "Cannot shorten a link pointing at this service" }, { status: 400 });
    }

    // Generate a unique short code
    let code = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = codeGenerator();
      const existing = await env.DB.prepare(
        "SELECT short_code FROM links WHERE short_code = ?"
      ).bind(candidate).first();
      if (!existing) {
        code = candidate; // no collision, use this one
        break;
      }
    }
    // Every attempt collided. Falling through here would insert the last known-colliding
    // candidate anyway, hit the UNIQUE constraint, and report it as a 500 — a server fault
    // the client can do nothing about. 503 says "temporarily unavailable, retry" instead.
    if (code === null) {
      return Response.json({ error: "Could not allocate a short code, please try again" }, { status: 503 });
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
    console.error("POST /api/shorten failed:", err);
    return Response.json({ error: "Something went wrong, please try again" }, { status: 500 });
  }
}
