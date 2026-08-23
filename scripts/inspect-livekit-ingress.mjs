import { readFileSync } from 'node:fs';
import { IngressClient } from 'livekit-server-sdk';

const envPath = process.argv[2];
if (!envPath) throw new Error('Informe o arquivo livekit.env.');

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const required = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
for (const key of required) {
  if (!env[key]) throw new Error(`Variável ausente: ${key}`);
}

const roomName = 'cineleo-palco';
const client = new IngressClient(
  env.LIVEKIT_URL.replace(/^wss:/, 'https:'),
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
);
const ingresses = await client.listIngress({ roomName });

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  roomName,
  ingresses: ingresses.map((ingress) => ({
    ingressId: ingress.ingressId,
    inputType: ingress.inputType,
    name: ingress.name,
    participantIdentity: ingress.participantIdentity,
    state: ingress.state?.status,
    enableTranscoding: ingress.enableTranscoding ?? false,
  })),
}, null, 2));
