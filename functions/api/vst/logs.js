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

function isSafeArray(value) {
  return Array.isArray(value) && value.length <= 100;
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
    const batchId = String(body.batchId || crypto.randomUUID());
    const previousBatchHash = String(body.previousBatchHash || "");
    const events = body.events;

    if (!sessionId) {
      return json(
        {
          ok: false,
          message: "sessionId is required."
        },
        400
      );
    }

    if (!isSafeArray(events)) {
      return json(
        {
          ok: false,
          message: "events must be an array with 100 items or fewer."
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

    const receivedAt = nowIso();

    const batchPayload = {
      sessionId,
      batchId,
      previousBatchHash,
      events,
      receivedAt
    };

    const batchHash = await sha256Hex(JSON.stringify(batchPayload));

    await env.VERIFLY_KV.put(
      `vst_logs:${sessionId}:${batchId}`,
      JSON.stringify({
        ...batchPayload,
        batchHash
      }),
      {
        expirationTtl: 60 * 60 * 24 * 30
      }
    );

    const updatedSession = {
      ...session,
      lastSeenAt: receivedAt,
      logBatchCount: Number(session.logBatchCount || 0) + 1,
      logEventCount: Number(session.logEventCount || 0) + events.length,
      lastBatchId: batchId,
      lastBatchHash: batchHash
    };

    await env.VERIFLY_KV.put(sessionKey, JSON.stringify(updatedSession), {
      expirationTtl: 60 * 60 * 24 * 30
    });

    return json({
      ok: true,
      batchId,
      batchHash,
      receivedAt
    });
  } catch (error) {
    return json(
      {
        ok: false,
        message: error.message || "Failed to save logs."
      },
      500
    );
  }
}

