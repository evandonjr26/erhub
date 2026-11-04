# Motion Studio v0.5 — atualização médica (04/11/2026)

**Branch experimental separada da produção:** `motion-studio-medical-v05`. A implantação Render que usuários acessam continua usando `motion-studio-render`. Não executar deploy sem verificar/guardar projetos: no Render Free os arquivos locais podem ser efêmeros.

## Incluído e testado no código
- Cinco novos templates científicos: potencial de ação, sinapse química, débito cardíaco, frequência cardíaca e trocas gasosas.
- Acoplamento por cue de palavra extraída do áudio e plano JSON `motion_plan` para renderers futuros; destaca Na+ na despolarização e K+ na repolarização.
- Cenas disponíveis para escolha no editor e biblioteca semântica autenticada em `GET /api/medical-library`.
- Adapter opcional WhisperX após correção textual, **desabilitado por padrão**; não instalado no Render Free e sem alegar precisão validada em pt-BR.
- Remoção de textos decorativos e contador de cena no HTML do HyperFrames; exportação atual em produção segue FFmpeg.
- Renderizações locais validadas em MP4 real H.264 + AAC 1080×1920 30fps; **27 testes automatizados passaram**.
- Não foram instalados Remotion, RemotionUI, Motion Canvas ou assets de terceiros nesta versão: seus direitos e recursos devem ser testados antes do uso.

## Fontes e licença
- Health Icons: CC0 — https://healthicons.org/
- Bioicons: licença por asset — https://bioicons.com/
- Servier Medical Art: CC BY 4.0 — https://smart.servier.com/
- Remotion: gratuita para indivíduos/equipes elegíveis, inclusive automação; organizações não elegíveis sujeitas aos termos — https://www.remotion.dev/docs/license/faq
- RemotionUI: MIT (não altera licença do Remotion) — https://github.com/riaz37/remotion-ui
- Motion Canvas: MIT — https://github.com/motion-canvas/motion-canvas

A versão inclui apenas desenhos programáticos originais: o catálogo externo está em status `catalog_reference_only`, sem downloads ou uso silencioso.

## Instalação de teste
O Dockerfile que já existe no diretório restaura o pacote `app-data.b64`. Para instalar WhisperX em máquina com recursos suficientes, adicionar manualmente a dependência `whisperx` e `ENABLE_WHISPERX=true`. O Render Free mantém este recurso desligado.
