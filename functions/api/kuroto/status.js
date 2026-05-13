function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");

  if (!sessionId) {
    return json(
      {
        ok: false,
        message: "session が指定されていません。"
      },
      400
    );
  }

  const session = await env.VERIFLY_KV.get(`kuroto:${sessionId}`, "json");

  if (!session) {
    return json(
      {
        ok: false,
        message: "認証セッションが見つかりません。"
      },
      404
    );
  }

  return json({
    ok: true,
    verified: Boolean(session.verified),
    reason: session.reason || "",
    metadata: {
      sessionId: session.sessionId,
      isrc: session.isrc,
      sns: session.sns,
      handle: session.handle,
      provider: session.provider,
      trackTitle: session.trackTitle,
      recordingId: session.recordingId,
      artistName: session.artistName,
      artistId: session.artistId,
      officialLinks: session.officialLinks || [],
      oauth: session.oauth || null
    }
  });
}
