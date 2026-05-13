function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = cookieHeader.split(";").map((item) => item.trim());

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }

  return "";
}

function clearCookie(name) {
  return [
    `${name}=`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0"
  ].join("; ");
}

function normalizeHandle(handle) {
  return String(handle || "").trim().replace(/^@/, "").toLowerCase();
}

async function exchangeCodeForToken({ code, codeVerifier, env }) {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", env.X_REDIRECT_URI);
  body.set("client_id", env.X_CLIENT_ID);
  body.set("code_verifier", codeVerifier);

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded"
  };

  if (env.X_CLIENT_SECRET) {
    headers.Authorization = `Basic ${btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)}`;
  }

  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Token exchange failed.");
  }

  return data;
}

async function fetchXUser(accessToken) {
  const response = await fetch(
    "https://api.x.com/2/users/me?user.fields=username,name,verified,verified_type",
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || data.title || "Failed to fetch X user.");
  }

  return data.data;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieState = getCookie(request, "verifly_oauth_state");
  const siteOrigin = env.SITE_ORIGIN || url.origin;

  function redirectToResult(sessionId, params = {}) {
    const resultUrl = new URL("/kuroto_ninsyo.html", siteOrigin);

    if (sessionId) resultUrl.searchParams.set("session", sessionId);
    resultUrl.searchParams.set("oauth", "done");

    Object.entries(params).forEach(([key, value]) => {
      resultUrl.searchParams.set(key, value);
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: resultUrl.toString(),
        "Set-Cookie": clearCookie("verifly_oauth_state")
      }
    });
  }

  if (error) return redirectToResult("", { error: "oauth_denied" });
  if (!code || !state) return new Response("Missing OAuth code or state.", { status: 400 });
  if (!cookieState || cookieState !== state) return new Response("Invalid OAuth state.", { status: 400 });

  const oauthState = await env.VERIFLY_KV.get(`oauth_state:${state}`, "json");
  if (!oauthState) return new Response("OAuth state expired.", { status: 400 });

  const sessionKey = `kuroto:${oauthState.sessionId}`;
  const session = await env.VERIFLY_KV.get(sessionKey, "json");
  if (!session) return new Response("Session not found.", { status: 404 });

  try {
    const token = await exchangeCodeForToken({
      code,
      codeVerifier: oauthState.codeVerifier,
      env
    });

    const xUser = await fetchXUser(token.access_token);
    const oauthHandle = normalizeHandle(xUser.username);
    const officialXHandles = Array.isArray(session.officialHandles?.x)
      ? session.officialHandles.x.map(normalizeHandle)
      : [];

    const accountMatched = officialXHandles.includes(oauthHandle);

    const updatedSession = {
      ...session,
      oauth: {
        provider: "x",
        userId: xUser.id,
        username: xUser.username,
        name: xUser.name,
        verifiedOnX: Boolean(xUser.verified),
        verifiedType: xUser.verified_type || null,
        checkedAt: new Date().toISOString()
      },
      verified: accountMatched,
      verifiedAt: accountMatched ? new Date().toISOString() : null,
      reason: accountMatched
        ? `OAuth account @${xUser.username} matched official X handle from ISRC metadata.`
        : `OAuth account @${xUser.username} did not match official X handles: ${officialXHandles.map((h) => "@" + h).join(", ") || "none"}.`
    };

    await env.VERIFLY_KV.put(sessionKey, JSON.stringify(updatedSession), {
      expirationTtl: 60 * 60 * 24
    });

    await env.VERIFLY_KV.delete(`oauth_state:${state}`);

    return redirectToResult(oauthState.sessionId);
  } catch (error) {
    const failedSession = {
      ...session,
      verified: false,
      reason: error.message,
      oauthErrorAt: new Date().toISOString()
    };

    await env.VERIFLY_KV.put(sessionKey, JSON.stringify(failedSession), {
      expirationTtl: 60 * 60 * 24
    });

    return redirectToResult(oauthState.sessionId, { error: "oauth_failed" });
  }
}
