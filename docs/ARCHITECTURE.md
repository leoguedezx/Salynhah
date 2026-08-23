# Arquitetura

```text
CineLéo Studio (Windows)
  Windows Graphics Capture → NVENC H.264 → FFmpeg WHIP
                                      │
                                      ▼
                              LiveKit Cloud SFU
                               │      │      │
                               ▼      ▼      ▼
                           navegador navegador navegador
```

## Decisões de desempenho

- O navegador não captura a tela do anfitrião. A captura e a codificação ficam
  no aplicativo Windows para reduzir variações do `getDisplayMedia`.
- NVENC usa tuning ultra-low-latency, preset P1, CBR, buffer VBV próximo de um
  quadro, sem B-frames e sem lookahead.
- O GOP é limitado a dois segundos para permitir recuperação e entrada de novos
  espectadores sem espera indefinida por um IDR.
- WHIP envia RTP com MTU de 1200 bytes e mantém histórico para NACK/RTX.
- O SFU evita multiplicar o upload do anfitrião pelo número de espectadores.

## Segurança

- `LIVEKIT_API_SECRET` existe somente no ambiente do servidor.
- O navegador recebe tokens temporários e permissões restritas.
- `studio/config.private.json` contém a autorização de publicação WHIP e nunca
  deve ser versionado ou compartilhado.
- Nome, foto e mensagens permanecem apenas durante a sessão.

## Diagnóstico

O site usa a API WebRTC Stats e `requestVideoFrameCallback` para separar:

- quadros recebidos/decodificados;
- quadros realmente apresentados pelo navegador;
- bitrate, perda de pacotes, jitter, RTT e protocolo da rota.
