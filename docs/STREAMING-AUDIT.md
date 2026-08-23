# Auditoria do streaming

Data da auditoria: 22 de agosto de 2026.

## Resumo executivo

O Salynhah não transmite a tela pelo navegador do anfitrião. O caminho real é
um aplicativo PowerShell/WPF que inicia o FFmpeg 8.1, captura um monitor com o
filtro `gfxcapture`, entrega quadros D3D11 ao `h264_nvenc` e publica H.264 por
WHIP. O LiveKit Ingress insere essa faixa em `cineleo-palco`; o SFU distribui a
mesma faixa para os navegadores. O viewer usa `RemoteTrack` diretamente em um
`HTMLVideoElement`, sem canvas intermediário.

```text
Monitor Windows
  -> FFmpeg gfxcapture (D3D11, resize no filtro)
  -> h264_nvenc (H.264 High, CBR, ULL)
  -> RTP/SRTP + WHIP do FFmpeg
  -> LiveKit WHIP Ingress (transcoding desativado)
  -> LiveKit SFU
  -> WebRTC do espectador
  -> decoder do navegador
  -> HTMLVideoElement / compositor / monitor
```

Essa arquitetura é apropriada para o produto: o host é instalado e o
espectador continua entrando apenas pelo link. Um empacotamento Electron não
melhoraria o caminho crítico.

## Evidência por componente

| Etapa | Implementação confirmada | Evidência no repositório |
| --- | --- | --- |
| Captura | `gfxcapture` por índice de monitor, cursor opcional, resize no próprio filtro | `studio/CineLeoStudio.ps1` |
| Frame de GPU | `gfxcapture` e `h264_nvenc` aceitam D3D11; não há `hwdownload`, `hwupload` ou filtro de CPU no comando | `studio/CineLeoStudio.ps1`; ajuda do FFmpeg 8.1 |
| Encoder | H.264 NVENC P1/ULL, CBR, sem B-frame e sem lookahead | `studio/CineLeoStudio.ps1` |
| Transporte do host | muxer WHIP do FFmpeg, RTP de 1200 bytes, histórico RTX 2048 | `studio/CineLeoStudio.ps1` |
| Ingress | WHIP com `enableTranscoding: false` | `scripts/provision-livekit-ingress.mjs` e inspeção runtime |
| Distribuição | uma faixa no LiveKit SFU | `app/page.tsx`, `app/api/livekit-token/route.ts` |
| Viewer | `RemoteTrack.attach(video)`, sem canvas ou cópia por JavaScript | `app/page.tsx` |
| Chat e voz | LiveKit Data e microfone WebRTC | `app/page.tsx` |

## O que o painel anterior media de forma incorreta

O campo `fps` de `-progress` é uma média reportada pelo FFmpeg, não uma prova de
que cada quadro veio de uma nova captura. Com `-r` e `-fps_mode cfr`, o FFmpeg
pode repetir ou descartar quadros para cumprir a linha de tempo pedida. O Studio
anterior exibia esse campo arredondado como se fosse FPS real.

A medição correta nesta fase usa deltas em janelas curtas:

- `encoded_fps = delta(frame) / delta(tempo)`;
- `duplicated_fps = delta(dup_frames) / delta(tempo)`;
- `unique_fps_estimate = delta(frame - dup_frames) / delta(tempo)`;
- `dropped_fps = delta(drop_frames) / delta(tempo)`.

`unique_fps_estimate` é explicitamente uma estimativa do pipeline FFmpeg, não
uma contagem nativa garantida do Windows Graphics Capture. `encoder input FPS`,
latência interna do NVENC e profundidade exata da fila não são expostos pelo
CLI atual e devem aparecer como indisponíveis, nunca como valores inventados.

## Parâmetros que exigem benchmark

### `-r` com CFR

Força a cadência de saída e pode mascarar captura abaixo da meta. Deve ser
comparado com timestamps nativos e `-fps_mode passthrough`. O perfil público só
deve usar CFR se o teste demonstrar melhor compatibilidade sem duplicação
relevante.

### `-surfaces 1`

No FFmpeg 8.1, `surfaces=0` seleciona automaticamente pelo menos quatro
superfícies no caso sem B-frames. Uma única superfície reduz buffering, mas
também elimina quase todo o pipeline entre submissão e coleta. Não há evidência
de que `1` seja a melhor escolha nesta GPU; serão testados auto, 1, 2, 3 e 4.

### `-multipass qres`

O multipass em quarter resolution pode melhorar o rate control, mas adiciona
trabalho. Será comparado com single-pass, principalmente em 1440p60 e 1080p120.

### `-ldkfs 200`

Na versão 8.1 do FFmpeg, `ldkfs` é copiado diretamente para
`NV_ENC_RC_PARAMS::lowDelayKeyFrameScale`, um inteiro de 0 a 255. Não há
conversão de unidade. Sunshine usa valor `1`; portanto `200` não equivale à
configuração do Sunshine e é um forte candidato a erro. A correção deve ser
validada com GOP de um e dois segundos e picos de IDR.

### VBV

O objetivo de um quadro é correto e deve ser calculado como
`bitrate_bps / fps`. Valores atuais aproximam essa conta, mas estão fixos em
texto. O Studio deve calcular o valor a partir do bitrate selecionado.

## Zero-copy: estado da evidência

Há evidência estrutural favorável:

- o build contém `gfxcapture`, `scale_d3d11`, D3D11VA e NVENC;
- `h264_nvenc` declara suporte a `d3d11`;
- o comando não contém `hwdownload`, `hwupload`, `format` ou `swscale`;
- o resize está dentro do próprio `gfxcapture`.

O teste real confirmou `pixfmt:d3d11` na entrada, a mensagem do encoder
`Using input frames context (format d3d11)` e saída NVENC com frames D3D11. Não
apareceu `hwdownload`, `hwupload` ou `swscale`. Portanto o grafo FFmpeg atual
mantém o frame na GPU até o NVENC. Isso não elimina eventuais cópias internas
do driver, mas elimina a suspeita de uma ida explícita VRAM -> RAM -> VRAM.

## LiveKit e transporte

O provisionamento cria WHIP com transcoding desligado. A documentação oficial
do LiveKit confirma que WHIP, por padrão, encaminha áudio e vídeo sem modificar
para obter a menor latência. A inspeção runtime é feita por
`scripts/inspect-livekit-ingress.mjs` sem imprimir tokens.

O muxer WHIP do FFmpeg 8.1 implementa histórico RTP e retransmissão RTX ao
receber NACK. O código trata Generic NACK (`RTPFB`, FMT 1). PLI é `PSFB`, não
passa por esse ramo e não chega ao encoder. Não foi encontrado controle de
bitrate por TWCC, REMB ou feedback de congestionamento no sender atual. Assim,
o bitrate é fixo durante a sessão e pode superar a capacidade instantânea da
rota mesmo com um teste de velocidade alto.

## Hipóteses ordenadas para os 20–40 FPS

1. Captura real abaixo da meta ou quadros repetidos escondidos por CFR.
2. Pipeline limitado por `surfaces=1` e/ou `multipass=qres` em certos perfis.
3. Bitrate fixo sem adaptação gerando perda, NACK/RTX, jitter e congestionamento.
4. Pacing/feedback limitado no muxer WHIP do FFmpeg.
5. Decoder/compositor/refresh do espectador, especialmente em 120 FPS.
6. Rota TCP/TURN ou região distante do SFU em testes WAN.

Internet de 600 Mb/s não elimina 3–6: throughput de teste não mede perda,
jitter, RTT, rota UDP/TCP, fila do roteador nem capacidade de decode/render.

## Limites honestos da fase atual

- `frames sent` no host significa quadros entregues ao muxer, não confirmação
  de recepção no LiveKit.
- NACK/RTX do host só pode ser extraído de log detalhado do muxer; o FFmpeg não
  expõe contadores estáveis em `-progress`.
- PLI/FIR/TWCC/REMB não são disponibilizados pelo sender atual.
- `requestVideoFrameCallback` mede apresentação pelo elemento de vídeo; o
  benefício visual final ainda é limitado pelo refresh do monitor.
- 120 FPS continua experimental até capture, encode, receive, decode e render
  sustentarem a meta.

## Fontes primárias

- Sunshine: <https://github.com/LizardByte/Sunshine>
- FFmpeg 8.1 NVENC: <https://github.com/FFmpeg/FFmpeg/blob/n8.1/libavcodec/nvenc.c>
- FFmpeg 8.1 WHIP: <https://github.com/FFmpeg/FFmpeg/blob/n8.1/libavformat/whip.c>
- NVIDIA NVENC Programming Guide: <https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvenc-video-encoder-api-prog-guide/index.html>
- LiveKit WHIP transcoding: <https://docs.livekit.io/transport/media/ingress-egress/ingress/transcode/>
- W3C WebRTC Stats: <https://www.w3.org/TR/webrtc-stats/>
