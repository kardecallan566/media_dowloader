# Media Finder Pro v1.2.0

Extensão Chrome Manifest V3 para detectar e baixar mídias de páginas acessíveis, sem DRM.

## Implementado
- Detecção por requisições, fontes HTML, links e metadados.
- Download direto de vídeo e áudio pelo gerenciador Chrome.
- HLS VOD: leitura do manifesto, escolha automática da variante de maior bitrate e download independente da reprodução.
- Suporte a EXT-X-MAP e BYTERANGE; segmentos baixados em ordem com tentativas e progresso.
- Download HLS no documento offscreen, sem depender do popup aberto.
- Preservação de MPEG-TS como .ts, sem MP4 falso; erros quando a playlist não pode ser montada.
- Limite de 450 MiB por transferência HLS para evitar esgotamento de memória.

## Limitações
- DASH detectado, mas ainda não baixado. Requer muxer.
- HLS com áudio separado, criptografia, descontinuidades ou playlist live não é suportado.
- Alguns sites só expõem a URL do manifesto após Play. Não é possível garantir suporte universal.
- DRM, fontes blob sem URL recuperável e conteúdo protegido não são suportados.
- TS pode precisar de remux externo para MP4.
- Arquivos grandes acima de 450 MiB e downloads interrompidos por reinício do navegador requerem arquitetura de streaming.

## Instalação
1. Abra chrome://extensions e ative o modo do desenvolvedor.
2. Escolha Carregar sem compactação e selecione a pasta do projeto.
3. Recarregue a aba com o vídeo, abra o popup e clique em Baixar vídeo.
4. Veja erros no service worker pela página de extensões.

Baixe apenas conteúdos que você tem permissão para obter.

## Próximos passos
- Muxer integrado de HLS TS/fMP4 e áudio separado.
- DASH SegmentTemplate/SegmentTimeline com mux.
- Streaming para disco e fila persistente.
- Testes automatizados de manifesto e downloads.
