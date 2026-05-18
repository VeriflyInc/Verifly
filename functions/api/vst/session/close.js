function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function nowIso() {
  return new Date().toISOString();
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.VERIFLY_KV) {
      return json(
        {
          ok: false,
          message: "VERIFLY_KV binding is missing."
        },
        500
      );
    }

    const body = await request.json();
    const sessionId = String(body.sessionId || "");

    if (!sessionId) {
      return json(
        {
          ok: false,
          message: "sessionId is required."
        },
        400
      );
    }

    const sessionKey = `vst_session:${sessionId}`;
    const session = await env.VERIFLY_KV.get(sessionKey, "json");

    if (!session) {
      return json(
        {
          ok: false,
          message: "Session not found."
        },
        404
      );
    }

    const closedAt = nowIso();

    const updatedSession = {
      ...session,
      status: "closed",
      lastSeenAt: closedAt,
      closedAt,
      closeReason: body.reason || "normal"
    };

    await env.VERIFLY_KV.put(sessionKey, JSON.stringify(updatedSession), {
      expirationTtl: 60 * 60 * 24 * 30
    });

    return json({
      ok: true,
      sessionId,
      closedAt
    });
  } catch (error) {
    return json(
      {
        ok: false,
        message: error.message || "Failed to close session."
      },
      500
    );
  }
}

