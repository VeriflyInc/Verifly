function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(values)
    .map((value) => chars[value % chars.length])
    .join("");
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  return crypto.subtle.digest("SHA-256", data);
}

function cookie(name, value, maxAge = 600) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`
  ].join("; ");
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");

  if (!sessionId) {
    return new Response("Missing session.", { status: 400 });
  }

  const session = await env.VERIFLY_KV.get(`kuroto:${sessionId}`, "json");

  if (!session) {
    return new Response("Session not found.", { status: 404 });
  }

  if (session.sns !== "x") {
    return new Response("This OAuth endpoint only supports X.", { status: 400 });
  }

  const codeVerifier = randomString(64);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
  const state = randomString(48);

  await env.VERIFLY_KV.put(
    `oauth_state:${state}`,
    JSON.stringify({
      sessionId,
      codeVerifier,
      createdAt: new Date().toISOString()
    }),
    { expirationTtl: 600 }
  );

  const authorizeUrl = new URL("https://x.com/i/oauth2/authorize");

  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", env.X_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", env.X_REDIRECT_URI);
  authorizeUrl.searchParams.set("scope", "users.read tweet.read");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl.toString(),
      "Set-Cookie": cookie("verifly_oauth_state", state)
    }
  });
}
