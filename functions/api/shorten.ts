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

// dotted-quad only: new URL() has already folded octal/hex/integer/IPv4-mapped forms
// into this shape before the hostname reaches here, so no other IPv4 notation is handled.
function isPrivateIPv4(hostname: string) {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return false;
  const [a, b] = hostname.split(".").map(Number);
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16, includes the cloud metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

// A 16-bit IPv6 group split into the two octets it represents once reassembled as IPv4.
function hexGroupToOctetPair(group: string) {
  const value = parseInt(group, 16);
  return [(value >> 8) & 0xff, value & 0xff];
}

// Only reached for bracketed literals (hostname.startsWith("[")) — see isPrivateHostname.
function isPrivateIPv6(hostname: string) {
  const inner = hostname.slice(1, -1);
  if (inner === "::1" || inner === "::") return true; // loopback / unspecified, must be exact matches
  if (inner.startsWith("::ffff:")) {
    // IPv4-mapped: reconstitute the dotted-quad and defer to the IPv4 ranges.
    // Not a mapped address unless it splits into exactly two 16-bit groups.
    const groups = inner.slice("::ffff:".length).split(":");
    if (groups.length !== 2) return false;
    const [hi, lo] = groups.map(hexGroupToOctetPair);
    return isPrivateIPv4(`${hi[0]}.${hi[1]}.${lo[0]}.${lo[1]}`);
  }
  if (inner.startsWith("fc") || inner.startsWith("fd")) return true; // fc00::/7, ULA
  if (["fe8", "fe9", "fea", "feb"].some((prefix) => inner.startsWith(prefix))) return true; // fe80::/10, link-local
  return false;
}

// hostname must already be normalized by `new URL()` (see functions/__tests__/shorten.test.ts
// for the forms this collapses). DNS is out of scope: a hostname that only resolves to a
// private address at request time — not in its literal form — is not caught here.
export function isPrivateHostname(hostname: string) {
  const name = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  if (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name.endsWith(".internal") ||
    name.endsWith(".local") ||
    name.endsWith(".home.arpa")
  ) {
    return true;
  }
  if (hostname.startsWith("[")) {
    return isPrivateIPv6(hostname);
  }
  return isPrivateIPv4(hostname);
}

export async function onRequestPost(
  context: EventContext<Env, string, unknown>,
  { codeGenerator = generateCode }: { codeGenerator?: () => string } = {}
): Promise<Response> {
  const { request, env } = context;

  let url: unknown;
  try {
    // A type argument here would only be a claim about the body: the typeof check below is
    // what actually establishes that `url` is a string, so it stays `unknown` until then.
    ({ url } = await request.json<{ url?: unknown }>());
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
    // Must run on the raw string, before new URL() — the parser removes LF and CR outright and
    // accepts NUL, so by the time it returns there is nothing left to detect. What goes into
    // target_url is this raw string, not parsedUrl.href, and those three characters are illegal
    // in a header value: GET /:code would create its 302 and throw, on every request, for as long
    // as the row exists. Tab is stripped the same way but is a legal header value, so it stays
    // allowed rather than widening this into a general "reject what the parser normalized" rule.
    if (/[\0\n\r]/.test(url)) {
      return Response.json({ error: "URL must not contain a line break or control character" }, { status: 400 });
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
    // Rejected, not stripped: target_url stores the raw string, so stripping the userinfo here
    // would validate one string and store another — the same split that let \0\n\r through
    // before they were caught on the raw input above. Credentials in a shortened link also flow
    // straight into GET /:code's Location header, and from there into logs and browser history.
    // The host-based checks below only see parsedUrl.hostname, so the userinfo is invisible to
    // them; https://trusted.example@evil.example is the classic @-confusion phishing form.
    if (parsedUrl.username || parsedUrl.password) {
      return Response.json({ error: "URL must not contain a username or password" }, { status: 400 });
    }
    // Refuse to shorten links pointing back at this service, which would redirect to itself.
    // Partial protection only: this compares against the hostname the request came in on, so a
    // deployment reachable under several hostnames (e.g. *.pages.dev plus a custom domain) can
    // still shorten a link aimed at one of its other hostnames.
    if (parsedUrl.hostname === new URL(request.url).hostname) {
      return Response.json({ error: "Cannot shorten a link pointing at this service" }, { status: 400 });
    }
    if (isPrivateHostname(parsedUrl.hostname)) {
      return Response.json({ error: "Cannot shorten a link pointing at a private or local address" }, { status: 400 });
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
    let code: string | null = null;
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
        // Not `err instanceof Error`: a thrown non-Error carrying a UNIQUE message would stop
        // being retried, which is a behaviour change rather than a typing one.
        if (!/UNIQUE constraint failed/i.test(String((err as { message?: unknown } | null)?.message ?? ""))) {
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
