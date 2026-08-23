# Comparação técnica com o Sunshine

Esta análise usa o Sunshine como referência de engenharia. Nenhum trecho do
Sunshine foi copiado para o Salynhah. O Sunshine é GPLv3; incorporar sua
implementação concreta poderia obrigar a distribuição do trabalho derivado sob
GPLv3. Os conceitos abaixo foram descritos e serão implementados de forma
independente no código do projeto.

## Comparação

| Área | Salynhah atual | Sunshine | Recomendação para o Salynhah |
| --- | --- | --- | --- |
| Cliente | navegador WebRTC | Moonlight/GameStream | manter navegador e LiveKit |
| Captura | FFmpeg `gfxcapture` | captura Windows própria, Desktop Duplication/WGC | medir o FFmpeg antes de reescrever |
| Memória | D3D11 implícito pelo grafo FFmpeg | texturas D3D11 compartilhadas e sincronizadas | confirmar o `hw_frames_ctx`; evitar `hwdownload` |
| Conversão | resize dentro do `gfxcapture` | shader D3D11 para formato do encoder | manter GPU; medir cópias internas |
| Encoder | `h264_nvenc` via FFmpeg | NVENC API direta com capability probing | manter FFmpeg se 60 FPS for sólido |
| Pacing | timestamps do filtro + CFR forçado | fila de captura, timeout e repetição intencional controlada | separar quadro novo de repetido |
| Rate control | CBR, VBV de ~1 quadro, qres fixo | CBR, VBV de 1 quadro, multipass configurável | VBV dinâmico; A/B single/qres |
| Surfaces | uma surface forçada | recurso de entrada registrado e caminho nativo | A/B auto/1/2/3/4 no FFmpeg |
| Recuperação | GOP de 2 s + NACK/RTX limitado | IDR sob pedido, RFI e FEC/protocolo próprio | manter GOP 1–2 s enquanto PLI não chega ao encoder |
| Rede | WHIP/WebRTC/LiveKit | protocolo GameStream/UDP próprio | não adotar Moonlight; melhorar feedback/adaptação WHIP |
| Capabilities | perfis hardcoded para RTX | consulta resolução, codec, bit depth, async e RFI | detectar GPU/codec/refresh antes de mostrar 120 FPS |

## Princípios observados no Sunshine

### Frames residentes na GPU

`display_vram.cpp` abre texturas D3D11 compartilhadas no dispositivo do
encoder, usa mutexes de GPU para sincronização e faz conversão por D3D11. Para
NVENC direto, o dispositivo registra/mapeia o recurso de textura em vez de
baixar pixels para RAM. Esse é o princípio mais importante a preservar.

### Capability probing

`nvenc_base.cpp` consulta largura/altura máximas, 10-bit, YUV444, encode
assíncrono, múltiplos reference frames e reference picture invalidation antes
de habilitar funções. O Salynhah não deve inferir capacidade apenas pelo nome
"RTX".

### Rate control de baixa latência

O Sunshine usa CBR, zero reorder delay, lookahead desligado, B-frames
desligados, VBV de aproximadamente um quadro e
`lowDelayKeyFrameScale = 1`. Multipass é configurável, não uma obrigação.

### Pacing explícito

`video.cpp` separa a thread de captura da thread de encode por fila. A rotina de
encode consome novos frames e só repete a imagem após timeout para manter uma
cadência mínima em conteúdo estático. Isso permite distinguir a origem da
repetição e associar timestamp ao quadro capturado.

### Recuperação própria, não transferível diretamente

`stream.cpp` possui controle específico do GameStream para IDR, invalidação de
reference frames, FEC e packet pacing. Essas técnicas não podem ser copiadas
diretamente para WHIP. No Salynhah, recuperação deve usar RTCP/WebRTC e um GOP
finito enquanto o sender não processar PLI/FIR corretamente.

## Diferenças que impedem copiar a arquitetura inteira

O Sunshine controla os dois extremos: servidor e Moonlight. O Salynhah controla
o host, mas o receptor é um navegador por trás do WebRTC/LiveKit. Portanto:

- não há protocolo de controle Moonlight para invalidação de reference frame;
- FEC, packet pacing e retransmissão do Sunshine não substituem RTCP/RTX do
  WebRTC;
- codecs precisam ser aceitos por navegador, LiveKit e Ingress;
- o SFU, ICE/TURN e congestion control entram no caminho.

## Arquitetura recomendada por fase

### Agora

```text
gfxcapture D3D11 -> h264_nvenc -> FFmpeg WHIP -> LiveKit -> browser
```

Adicionar instrumentação, capability detection, perfis honestos, VBV dinâmico,
benchmark de surface/multipass/pacing/GOP e adaptação conservadora de bitrate.

### Somente se o limite for comprovado

```text
Windows Graphics Capture / Desktop Duplication
  -> ID3D11Texture2D
  -> shader D3D11 de resize/colorspace
  -> NVENC API direta
  -> sender WebRTC/WHIP nativo
  -> LiveKit SFU
```

C++20 é a escolha inicial mais direta para D3D11, WinRT/WGC e NVENC SDK. Rust só
deve ser escolhido se as bindings e a equipe compensarem a maior integração
FFI. A UI pode permanecer separada do motor.

## Arquivos Sunshine estudados

- `src/nvenc/nvenc_base.cpp`
- `src/nvenc/`
- `src/platform/windows/display_vram.cpp`
- `src/platform/windows/display_base.cpp`
- `src/video.cpp`
- `src/stream.cpp`

Referência: <https://github.com/LizardByte/Sunshine>

