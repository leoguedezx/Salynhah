import { readFileSync } from 'node:fs';
import { RoomServiceClient } from 'livekit-server-sdk';

const envPath = process.argv[2];
if (!envPath) throw new Error('Informe o arquivo livekit.env.');

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const client = new RoomServiceClient(
  env.LIVEKIT_URL.replace(/^wss:/, 'https:'),
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
);
const roomName = 'cineleo-palco';
const rooms = await client.listRooms([roomName]);
const participants = rooms.length ? await client.listParticipants(roomName) : [];

console.log(JSON.stringify({
  roomActive: rooms.length === 1,
  participants: participants.map((participant) => ({
    identity: participant.identity,
    tracks: participant.tracks.map((track) => ({
      height: track.height,
      muted: track.muted,
      name: track.name,
      source: track.source,
      type: track.type,
      width: track.width,
    })),
  })),
}));
