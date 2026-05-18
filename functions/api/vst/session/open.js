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

    const body = await request.json().catch(() => ({}));
    const sessionId = crypto.randomUUID();

    const session = {
      sessionId,
      status: "open",
      source: body.source || "verifly-standalone",
      appVersion: body.appVersion || "",
      userTokenHint: body.userTokenHint || "",
      deviceId: body.deviceId || "",
      dawName: body.dawName || "standalone",
      sampleRate: body.sampleRate || null,
      openedAt: nowIso(),
      lastSeenAt: nowIso(),
      closedAt: null,
      logBatchCount: 0,
      logEventCount: 0
    };

    await env.VERIFLY_KV.put(
      `vst_session:${sessionId}`,
      JSON.stringify(session),
      {
        expirationTtl: 60 * 60 * 24 * 30
      }
    );

    return json({
      ok: true,
      sessionId,
      serverTime: nowIso()
    });
  } catch (error) {
    return json(
      {
        ok: false,
        message: error.message || "Failed to open session."
      },
      500
    );
  }
}

