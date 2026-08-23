# Salynhah

Sala de cinema virtual para compartilhar a tela em Full HD ou 2K, com perfis de
até 120 FPS, chat e voz. Os convidados entram pelo link, escolhem um nome e não
precisam criar conta.

## Como funciona

- **Site:** Next.js/Vinext + LiveKit Client para vídeo, chat e microfone.
- **Servidor:** rota segura que gera tokens temporários do LiveKit.
- **Studio:** transmissor para Windows com FFmpeg, Windows Graphics Capture,
  H.264 NVENC e WHIP.
- **Distribuição:** o Studio envia uma única cópia ao LiveKit SFU; cada
  espectador recebe sua própria rota WebRTC.

## Perfis do Studio

| Perfil | Resolução | FPS | Bitrate alvo |
| --- | ---: | ---: | ---: |
| Estável | 1920×1080 | 60 | 10 Mbps |
| Ultra | 1920×1080 | 120 | 16 Mbps |
| Cinema | 2560×1440 | 60 | 16 Mbps |

O perfil **1080p60 Estável** é o padrão recomendado. O painel da sala mostra
separadamente FPS recebido, FPS exibido, bitrate, perda, jitter e latência.

## Executar o site

Requisitos: Node.js 22.13+ e pnpm.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Preencha `.env.local` com as credenciais do seu projeto LiveKit. Nunca publique
esse arquivo.

## CineLéo Studio

Veja [studio/README.md](studio/README.md). O arquivo privado
`studio/config.private.json` não faz parte do repositório.

## Build

```bash
pnpm build
```

Mais detalhes estão em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
