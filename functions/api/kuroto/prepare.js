function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function normalizeISRC(value) {
  return String(value || "")
    .trim()
    .replace(/-/g, "")
    .replace(/\s/g, "")
    .toUpperCase();
}

function normalizeHandle(value) {
  return String(value || "").trim();
}

function isValidISRC(isrc) {
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(isrc);
}

function musicBrainzHeaders(env) {
  const contact = env.CONTACT_EMAIL || "no-contact@example.com";

  return {
    "User-Agent": `Verifly/0.1 (${contact})`,
    "Accept": "application/json"
  };
}

function pickFirstRecording(data) {
  if (Array.isArray(data.recordings) && data.recordings.length > 0) {
    return data.recordings[0];
  }

  if (Array.isArray(data["isrcs"]) && data.isrcs[0]?.recordings?.length > 0) {
    return data.isrcs[0].recordings[0];
  }

  return null;
}

function getArtistFromRecording(recording) {
  const artistCredit = recording?.["artist-credit"];

  if (!Array.isArray(artistCredit) || artistCredit.length === 0) {
    return {
      artistName: "",
      artistId: ""
    };
  }

  const firstCredit = artistCredit.find((credit) => credit.artist)?.artist;

  return {
    artistName: firstCredit?.name || "",
    artistId: firstCredit?.id || ""
  };
}

function isSocialOrOfficialUrl(url) {
  return [
    "x.com",
    "twitter.com",
    "instagram.com",
    "youtube.com",
    "youtu.be",
    "facebook.com",
    "tiktok.com",
    "spotify.com",
    "music.apple.com",
    "soundcloud.com",
    "bandcamp.com"
  ].some((domain) => url.includes(domain));
}

async function fetchArtistLinks(artistId, env) {
  if (!artistId) return [];

  const url = `https://musicbrainz.org/ws/2/artist/${encodeURIComponent(
    artistId
  )}?inc=url-rels&fmt=json`;

  const response = await fetch(url, {
    headers: musicBrainzHeaders(env)
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  const relations = Array.isArray(data.relations) ? data.relations : [];

  return relations
    .map((relation) => {
      const targetUrl = relation?.url?.resource || "";

      return {
        type: relation.type || "url",
        url: targetUrl
      };
    })
    .filter((link) => link.url)
    .filter((link) => isSocialOrOfficialUrl(link.url.toLowerCase()));
}

async function lookupMusicBrainzByISRC(isrc, env) {
  const url = `https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(
    isrc
  )}?inc=recordings+artist-credits+releases&fmt=json`;

  const response = await fetch(url, {
    headers: musicBrainzHeaders(env)
  });

  if (!response.ok) {
    throw new Error("MusicBrainzでISRCを検索できませんでした。");
  }

  const data = await response.json();
  const recording = pickFirstRecording(data);

  if (!recording) {
    throw new Error("このISRCに紐づく楽曲がMusicBrainzで見つかりませんでした。");
  }

  const artist = getArtistFromRecording(recording);
  const officialLinks = await fetchArtistLinks(artist.artistId, env);

  return {
    provider: "MusicBrainz",
    trackTitle: recording.title || "不明",
    recordingId: recording.id || "",
    artistName: artist.artistName || "不明",
    artistId: artist.artistId || "",
    officialLinks
  };
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    const isrc = normalizeISRC(body.isrc);
    const sns = String(body.sns || "").trim();
    const handle = normalizeHandle(body.handle);

    if (!isrc) {
      return json({ ok: false, message: "ISRCコードを入力してください。" }, 400);
    }

    if (!isValidISRC(isrc)) {
      return json(
        { ok: false, message: "ISRCコードの形式が正しくありません。" },
        400
      );
    }

    if (!sns) {
      return json({ ok: false, message: "SNSを選択してください。" }, 400);
    }

    if (!handle.startsWith("@")) {
      return json(
        { ok: false, message: "SNS IDは @ から始めてください。" },
        400
      );
    }

    if (sns !== "x") {
      return json(
        {
          ok: false,
          message: "現在このデモではX OAuthのみ対応しています。"
        },
        400
      );
    }

    const metadata = await lookupMusicBrainzByISRC(isrc, env);
    const sessionId = crypto.randomUUID();

    const session = {
      sessionId,
      isrc,
      sns,
      handle,
      provider: metadata.provider,
      trackTitle: metadata.trackTitle,
      recordingId: metadata.recordingId,
      artistName: metadata.artistName,
      artistId: metadata.artistId,
      officialLinks: metadata.officialLinks,
      verified: false,
      reason: "OAuth verification has not started.",
      createdAt: new Date().toISOString()
    };

    await env.VERIFLY_KV.put(`kuroto:${sessionId}`, JSON.stringify(session), {
      expirationTtl: 60 * 60 * 24
    });

    return json({
      ok: true,
      sessionId,
      isrc,
      sns,
      handle,
      provider: metadata.provider,
      trackTitle: metadata.trackTitle,
      artistName: metadata.artistName,
      artistId: metadata.artistId,
      officialLinks: metadata.officialLinks,
      oauthUrl: `/api/oauth/x/start?session=${encodeURIComponent(sessionId)}`
    });
  } catch (error) {
    return json(
      {
        ok: false,
        message: error.message || "認証準備中にエラーが発生しました。"
      },
      500
    );
  }
}
