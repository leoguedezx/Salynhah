import { AccessToken, TrackSource } from 'livekit-server-sdk';

const ROOM_NAME = 'cineleo-palco';

function safeName(value: unknown) {
  if (typeof value !== 'string') return 'Convidado';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Convidado';
}

function safeRole(value: unknown): 'host' | 'guest' {
  return value === 'host' ? 'host' : 'guest';
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { name?: unknown; role?: unknown };
    const name = safeName(body?.name);
    const role = safeRole(body?.role);
    const serverUrl = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!serverUrl || !apiKey || !apiSecret) {
      return Response.json(
        { error: 'A sala está temporariamente sem conexão com o projetor.' },
        { status: 503 },
      );
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: `cineleo-web-${crypto.randomUUID()}`,
      name,
      metadata: JSON.stringify({ role }),
      ttl: '6h',
    });
    token.addGrant({
      room: ROOM_NAME,
      roomJoin: true,
      canSubscribe: true,
      canPublish: true,
      canPublishData: true,
      canPublishSources: [TrackSource.MICROPHONE],
    });

    return Response.json(
      { serverUrl, roomName: ROOM_NAME, token: await token.toJwt() },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch {
    return Response.json(
      { error: 'Não foi possível preparar seu ingresso para a sessão.' },
      { status: 500 },
    );
  }
}
