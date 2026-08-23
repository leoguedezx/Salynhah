# Benchmarks de streaming

Este documento separa capacidade de captura/encode, transporte e viewer. Um
perfil não é aprovado só porque foi configurado com o FPS desejado.

## Ambiente conhecido

- GPU: NVIDIA GeForce RTX 5070
- Driver observado: 610.74
- FFmpeg: 8.1 essentials build (gyan.dev)
- Encoder: `h264_nvenc`
- Captura: `gfxcapture`
- Transporte: FFmpeg WHIP -> LiveKit Cloud -> WebRTC
- Ingress: transcoding desativado

## Resultados preliminares existentes

Esses números foram obtidos antes do modo diagnóstico completo e não aprovam os
tiers de produto:

| Teste | Resultado | O que prova | Limitação |
| --- | ---: | --- | --- |
| `gfxcapture` + resize, alvo 120, 5 s | 600 quadros; speed ~0,997x | o caminho consegue produzir uma linha de tempo de 120 FPS | cena pouco controlada e CFR pode duplicar |
| encode isolado `testsrc2` 1080p60 | 4,65x tempo real | NVENC tem folga para 60 FPS | fonte sintética, sem rede |
| encode isolado `testsrc2` 1080p120 | 2,97x tempo real | NVENC tem throughput bruto para 120 FPS | fonte sintética, sem rede |
| encode isolado `testsrc2` 1440p60 | 3,48x tempo real | NVENC tem folga para 1440p60 | fonte sintética, sem rede |

Conclusão provisória: a capacidade bruta do encoder não explica sozinha os
20–40 FPS observados. O próximo alvo é medir captura única, pacing do FFmpeg,
WHIP/rede e decode/render separadamente.

## Matriz local de 22/08/2026

Fonte sintética `testsrc2`, dez segundos de mídia por caso, saída local nula.
O valor é throughput do encoder e pode ser maior que tempo real.

| Perfil | Configuração antiga (`surfaces=1`, qres) | Melhor faixa single-pass | Ganho de folga |
| --- | ---: | ---: | ---: |
| 1080p60 | 381 FPS | 487 FPS com surfaces=2 | +27,8% |
| 1440p60 | 232 FPS | 290 FPS com surfaces=2 | +25,0% |
| 1080p120 | 437 FPS | 513 FPS com surfaces=2 | +17,4% |

Com folga ampla em todos os tiers, o preset de produção passou para
`surfaces=2` e single-pass. Duas superfícies preservam alguma concorrência sem
adotar a fila automática maior. A decisão ainda deve ser revalidada em cena de
alto movimento e no teste ponta a ponta.

### Captura rápida

Em uma área de trabalho pouco movimentada, CFR produziu aproximadamente 59–60
FPS de saída, mas a estimativa de quadros novos ficou por volta de 49–51 FPS e
houve 26–32 duplicações em três segundos. Sem CFR, o `gfxcapture` produziu cerca
de 51,5 FPS. Esse teste demonstra que CFR mascara repetições; não demonstra o
limite de captura em movimento, pois Windows Graphics Capture pode não produzir
um frame novo quando o conteúdo permanece igual. O teste decisivo precisa de
uma cena controlada de alto movimento.

### Zero-copy

O log do FFmpeg confirmou entrada `d3d11`, `hw_frames_ctx` D3D11 no
`h264_nvenc` e nenhuma etapa `hwdownload`, `hwupload` ou `swscale`.

## Matriz A/B obrigatória

Executar em cena de alto movimento, primeiro sem rede:

| Variável | Valores |
| --- | --- |
| Resolução/FPS | 1080p60, 1440p60, 1080p120 |
| Pacing | timestamps nativos/passthrough; `-r` + CFR |
| Surfaces | auto, 1, 2, 3, 4 |
| Multipass | disabled, qres |
| GOP | 1 s, 2 s |
| Bitrate 1080p60 | 8, 10, 12, 15, 20 Mb/s |
| Bitrate 1440p60 | 12, 16, 20, 25, 30 Mb/s |
| Bitrate 1080p120 | 12, 16, 20, 25, 30 Mb/s |

Registrar para cada amostra: média, mediana, 1% low, variância de frame time,
quadros de saída, estimativa de quadros únicos, duplicados, descartados, speed,
bitrate, GPU, Video Encode e duração.

## Aprovação dos tiers

| Tier | Capture/único | Encode | Receive/decode | Render | Estado |
| --- | ---: | ---: | ---: | ---: | --- |
| 1080p60 | >=59 sustentado | >=59 | >=59 | ideal >=58 | não aprovado ainda |
| 1440p60 | >=59 sustentado | >=59 | >=59 | ideal >=58 | não aprovado ainda |
| 1080p120 | >=118 | >=118 | >=118 em receptor capaz | próximo de 118 em display >=120 Hz | experimental |
| 1440p120 | >=118 | >=118 | >=118 em receptor capaz | próximo de 118 em display >=120 Hz | não iniciado |

## Protocolo LAN/WAN

1. Repetir host e viewer na LAN, preferencialmente por cabo.
2. Repetir pela Internet sem mudar perfil.
3. Comparar bitrate, perda, jitter, RTT, protocolo e candidate type.
4. Se LAN sustentar 60 e WAN não, priorizar rota/bitrate/congestionamento.
5. Se encode local falhar, não investigar LiveKit antes de corrigir o host.

## Como interpretar

- Capture 60, encode 40: gargalo captura -> encoder.
- Encode 60, receive 40: sender, WHIP, SFU ou rede.
- Receive 60, decode 30: decoder do receptor.
- Decode 60, render 30: navegador/compositor/display.
- Capture 40: origem/frame pacing já está abaixo da meta.

Os resultados gerados por `studio/Run-StreamingBenchmarks.ps1` devem ser
anexados aqui somente depois de uma execução controlada.
