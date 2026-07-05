# Projeto de Atualização: Media Finder Pro 🚀

Este documento detalha a nova arquitetura e as melhorias planejadas para a extensão, focando em resolver o problema de downloads HLS/MPD e elevar o nível de profissionalismo do código e da interface.

## 1. Análise do Problema HLS/MPD
Atualmente, a extensão utiliza `MediaRecorder` para gravar a reprodução do vídeo. Isso tem várias limitações:
- **Dependência de Reprodução**: O usuário precisa assistir ao vídeo para baixá-lo.
- **Qualidade Limitada**: A gravação é limitada à resolução que está sendo exibida.
- **Falhas em HLS/MPD**: Streams adaptativos mudam de resolução ou segmentam dados de forma que o `MediaRecorder` pode falhar ou gerar arquivos corrompidos.

## 2. Nova Arquitetura de Download

### A. Interceptação de Manifestos (HLS/DASH)
- **Background Script**: Continuará interceptando requisições `.m3u8` e `.mpd`.
- **Parser**: Adicionaremos uma lógica para analisar esses manifestos e extrair as URLs dos segmentos.

### B. Motor de Download por Segmentos
Em vez de gravar o elemento `<video>`, a extensão irá:
1. Buscar o manifesto.
2. Listar as qualidades disponíveis (720p, 1080p, etc).
3. Baixar os segmentos (`.ts` ou `.m4s`) via `fetch` paralelo.
4. **Concatenar Segregados**: Usar `StreamSaver.js` ou `ffmpeg.wasm` (se necessário para conversão) para unir os segmentos em um arquivo único.

## 3. Melhorias de UI/UX (Design Profissional)

### A. Interface do Popup
- **Framework**: Migrar para uma estrutura mais modular (ou manter Vanilla JS mas com componentes bem definidos).
- **Feedback Visual**: Adicionar barras de progresso reais para downloads em segundo plano.
- **Filtros**: Permitir filtrar por tipo de mídia (Vídeo, Áudio, Imagem).

### B. Overlay no Vídeo (Content Script)
- **Menu Moderno**: Substituir o menu atual por um mais discreto e integrado.
- **Detecção Inteligente**: Melhorar a detecção de players que usam Shadow DOM.

## 4. Stack Tecnológica Sugerida
- **m3u8-parser**: Para processar playlists HLS.
- **dashjs / mpd-parser**: Para processar manifestos DASH.
- **ffmpeg.wasm**: Para muxing de áudio e vídeo quando vêm separados (comum em YouTube e DASH).

## 5. Plano de Implementação
1. **Fase 1**: Refatorar o Background para identificar e armazenar metadados de manifestos.
2. **Fase 2**: Implementar o gerenciador de downloads no Popup.
3. **Fase 3**: Integrar biblioteca de parsing de HLS/MPD.
4. **Fase 4**: Polimento da UI e testes de regressão.
