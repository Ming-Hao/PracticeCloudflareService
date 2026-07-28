// Matches the de facto browser address bar limit, so a shortened link stays usable everywhere
const MAX_URL_LENGTH = 2048;

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// Random bytes run 0-255 but the alphabet has 62 characters, and 256 is not a
// multiple of 62 (256 = 4*62 + 8). Taking `byte % 62` directly would map those 8
// leftover values onto the first 8 letters, so a-h would come out roughly 21%
// more often than every other character. Discarding the leftover values is all
// the loop below does — the goal is simply that no character is favoured.
const REJECTION_LIMIT = 256 - (256 % CODE_ALPHABET.length);

// Generates a random short code. A short code is the only thing guarding a link
// (GET /:code performs no other check), so the randomness has to be
// cryptographic — Math.random()'s xorshift128+ state is recoverable from its output.
export function generateCode(length = 8) {
  let code = "";
  while (code.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length - code.length))) {
      if (byte >= REJECTION_LIMIT) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
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

    // Generate the delete token, only ever returned in this response
    const deleteToken = crypto.randomUUID();
    // created_at must be ISO 8601 with an explicit Z — the frontend parses it with
    // new Date(). SQLite's CURRENT_TIMESTAMP format ("YYYY-MM-DD HH:MM:SS") has no
    // timezone marker and browsers parse it as *local* time.
    // Also: never accept a client-supplied timestamp (clock skew, tampering).
    const createdAt = new Date().toISOString();

    // Claim a short code by inserting it and letting the UNIQUE constraint report
    // collisions. Checking with a SELECT first would be two round-trips and still
    // racy: another request can insert the same code between the check and the insert.
    let code = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = codeGenerator();
      try {
        await env.DB.prepare(
          "INSERT INTO links (short_code, target_url, delete_token, created_at) VALUES (?, ?, ?, ?)"
        ).bind(candidate, url, deleteToken, createdAt).run();
        code = candidate;
        break;
      } catch (err) {
        // Only a collision is worth retrying; any other DB fault must surface as a 500.
        // String(...) because a thrown non-Error has no .message, and .test(undefined)
        // would silently match against the literal string "undefined".
        if (!/UNIQUE constraint failed/i.test(String(err?.message ?? ""))) {
          throw err;
        }
      }
    }
    // Every attempt collided. 503 says "temporarily unavailable, retry" — unlike a 500,
    // it tells the client this is not a fault it should give up on.
    if (code === null) {
      return Response.json({ error: "Could not allocate a short code, please try again" }, { status: 503 });
    }

    return Response.json({ short_code: code, target_url: url, delete_token: deleteToken, created_at: createdAt });
  } catch (err) {
    console.error("POST /api/shorten failed:", err);
    return Response.json({ error: "Something went wrong, please try again" }, { status: 500 });
  }
}
