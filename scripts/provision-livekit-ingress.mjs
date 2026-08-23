import { readFileSync, writeFileSync } from 'node:fs';
import { IngressClient, IngressInput } from 'livekit-server-sdk';

const [envPath, outputPath] = process.argv.slice(2);
if (!envPath || !outputPath) {
  throw new Error('Uso: node provision-livekit-ingress.mjs <livekit.env> <ingress.json>');
}

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
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
const ingressName = 'CineLeo Studio 1080p120';
const apiHost = env.LIVEKIT_URL.replace(/^wss:/, 'https:');
const ingressClient = new IngressClient(
  apiHost,
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
);

const existing = (await ingressClient.listIngress({ roomName })).find(
  (item) => item.name === ingressName,
);
const ingress = existing ?? await ingressClient.createIngress(IngressInput.WHIP_INPUT, {
  name: ingressName,
  roomName,
  participantIdentity: 'cineleo-studio',
  participantName: 'CineLéo Studio',
  participantMetadata: JSON.stringify({ role: 'host', quality: '1080p120' }),
  enableTranscoding: false,
});

writeFileSync(
  outputPath,
  `${JSON.stringify({
    ingressId: ingress.ingressId,
    ingressUrl: ingress.url,
    ingressToken: ingress.streamKey,
    roomName: ingress.roomName,
    participantIdentity: ingress.participantIdentity,
  }, null, 2)}\n`,
  { encoding: 'utf8', mode: 0o600 },
);

console.log(JSON.stringify({
  created: !existing,
  ingressId: ingress.ingressId,
  roomName: ingress.roomName,
  inputType: 'WHIP',
  transcoding: ingress.enableTranscoding ?? false,
}));
