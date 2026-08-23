# Salynhah Studio para Windows

O Studio captura um monitor, codifica na GPU NVIDIA e publica o vídeo no LiveKit
por WHIP.

## Instalação

1. Instale uma versão do FFmpeg com `gfxcapture`, `h264_nvenc` e muxer `whip`.
2. Copie `config.example.json` para `config.private.json`.
3. Preencha a URL e o token do seu WHIP Ingress.
4. Execute `Iniciar CineLeo Studio.cmd`.
5. Escolha monitor e perfil e inicie a transmissão.

## Privacidade

`config.private.json` permite publicar vídeo na sala. Ele está bloqueado pelo
`.gitignore`; nunca o envie ao GitHub ou a outra pessoa.

## Perfis

- **1080p60 Estável:** melhor ponto de partida.
- **1080p120 Ultra:** requer monitor, rota e decodificador rápidos.
- **2K60 Cinema:** prioriza definição.

As decisões de encoder foram inspiradas no projeto open source
[Sunshine](https://github.com/LizardByte/Sunshine), mantendo LiveKit/WHIP para
que convidados possam assistir diretamente pelo navegador.
