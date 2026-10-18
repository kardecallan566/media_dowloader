# Media Finder Pro · v1.14.1

## Interface mais compacta para playlists do YouTube

A ferramenta **Baixar playlist do YouTube** foi movida do topo da página para um **botão com ícone de lista e download**, ao lado de **Atualizar** e **Limpar** no cabeçalho.

- Ao clicar no ícone, abre-se um painel sobreposto contendo **link da playlist, formato MP3/M4A/Opus, sessão opcional, botão Baixar, cancelamento e progresso**. Fechar o painel não encerra os downloads em lote.
- O painel fica oculto por padrão para manter a lista de vídeos, imagens e áudios visível e organizada.
- Para fechar, use o botão **×**, a tecla **Esc** ou clique fora do painel; o foco do teclado é mantido dentro do diálogo enquanto ele estiver aberto e volta ao botão que o abriu.
- Enquanto uma playlist está em processamento, o ícone apresenta um indicador discreto. Um lote concluído ou com pendências também apresenta uma distinção visual para facilitar o acesso ao status.
- A extensão lembra o **último link de playlist validado e o formato selecionado**, para facilitar downloads futuros. Não grava automaticamente a escolha de sessão/cookies.
- Ao abrir a extensão em uma página de playlist do YouTube, o link é preenchido automaticamente; o painel permanece fechado até você clicar no ícone.

**Atualização:** na pasta do projeto execute `git pull origin main`, acesse `brave://extensions`, clique em **Recarregar** no Media Finder Pro e reabra o popup. Confira **v1.14.1** no rodapé.

Como foram alterados apenas HTML, CSS e JavaScript da extensão, **não é necessário recompilar o executável Python** desta vez. O assistente da v1.14.0 continua compatível.

---

## Novo: baixar o áudio de playlists inteiras do YouTube

A extensão agora inclui um painel **♫ Baixar playlist do YouTube** acima das abas de mídia. Você pode colar um link no formato `https://www.youtube.com/playlist?list=...` (ou abrir um vídeo que contenha o parâmetro `list`), escolher o formato e iniciar um processamento em lote pelo assistente local yt-dlp/FFmpeg.

- **Formatos:** MP3 128/192/320 kbps, M4A e Opus, iguais ao modo de áudio individual.
- **Uma faixa por arquivo:** não junta toda a playlist em um arquivo único e não produz arquivos de vídeo como saída final. Os arquivos ficam em `Downloads/MediaFinder/Playlists/<playlist-id>/<formato>/`.
- **Sem limite fixo de quantidade de faixas:** o yt-dlp percorre os vídeos da playlist, sujeito a disponibilidade, restrições do site, espaço em disco e duração do processamento.
- **Retomada sem duplicar:** um arquivo de histórico `.completed-ids.txt` é mantido na pasta de cada playlist/formato. Ao repetir o mesmo download, o yt-dlp ignora os vídeos registrados como concluídos e usa suporte a arquivos parciais.
- **Erros parciais:** vídeos removidos, privados ou indisponíveis são ignorados para permitir continuar os demais. O painel acompanha a faixa atual, número de áudios salvos e falhas e explica quando não foi possível baixar tudo.
- **Sessão opcional:** sem cookies por padrão. Você pode escolher Brave ou Firefox, somente se tiver acesso autorizado; isso não remove DRM nem contorna autenticação.
- **Execução independente do popup:** enquanto o Brave e seu assistente local estiverem ativos, a conexão nativa mantém o lote em andamento após fechar a janelinha da extensão. Ao abri-la novamente, o estado é recuperado. Se o navegador ou o PC encerrar o processo, execute novamente para retomar.
- **Cancelar:** interrompe o processo yt-dlp/FFmpeg; arquivos concluídos continuam no disco e no histórico.
- **Segurança:** apenas URLs de playlists específicas do domínio oficial do YouTube são aceitas. Não são aceitos links de busca, canais, redirecionamentos ou páginas de vídeo isolado sem `list`.

### Atualização da v1.13.0

Execute `git pull origin main` e depois **recompile o assistente nativo**, executando `powershell -ExecutionPolicy Bypass -File .\\native\\install.ps1 -ExtensionId SEU_ID`. Feche o Brave completamente, reabra-o e recarregue o Media Finder Pro em `brave://extensions`. O rodapé deve exibir **v1.14.0**.

Os testes automatizados cobrem validação e normalização dos links, argumentos de segurança do yt-dlp, estrutura de pastas, retomada, validação de cada arquivo, cancelamento e relatório de falhas. O download de uma playlist real depende do acesso permitido pelo YouTube e não é considerado confirmado por esses testes automatizados.

---

## Novo: baixar somente o áudio dos vídeos

Agora é possível **extrair apenas o som de vídeos acessíveis**, sem salvar primeiro o arquivo de vídeo. A extensão usa o assistente local opcional **yt-dlp + FFmpeg**, já utilizado nos downloads anteriores.

- A aba **Áudios** passou a incluir vídeos detectados que oferecem a extração pelo assistente (além dos arquivos de áudio independentes já encontrados na página).
- Também foi adicionado **♫ Baixar apenas áudio** aos cards de vídeo compatíveis.
- **Formatos:** MP3 128 kbps, MP3 192 kbps (padrão), MP3 320 kbps, M4A e Opus. As opções MP3 controlam a taxa de conversão, mas não melhoram o som além da qualidade do original.
- **Instagram, YouTube e Pinterest:** use o link individual da publicação/vídeo, detectado automaticamente quando possível ou informado manualmente, para solicitar áudio sem baixar o vídeo como saída final. Sessões do Brave/Firefox continuam opcionais e requerem escolha explícita.
- **Streams MP4/HLS dos pares de site e CDN previamente reconhecidos:** permitem extração via assistente local, com a referência da página onde a mídia foi reproduzida. Uma playlist expirada ou protegida não pode ser baixada sem autorização.
- **Validação final:** o assistente confere com FFprobe se o resultado realmente contém áudio e se não inclui faixa de vídeo, antes de exibir sucesso.
- **Arquivos:** são salvos em `Downloads/MediaFinder`. O botão Cancelar interrompe o processo quando solicitado.

**Limitação:** o navegador não possui uma função nativa universal de extrair MP3 de qualquer vídeo detectado. O fluxo de extração exige uma URL suportada pelo assistente, fonte acessível e FFmpeg funcional. A aba Áudios mantém o download direto de arquivos MP3/M4A/etc. que o site já disponibiliza. Não foi incluído contorno de DRM ou autenticação.

### Atualização

Execute `git pull origin main` no diretório do projeto. Como `native/host.py` mudou, **recompile o assistente** usando `native/install.ps1` com o mesmo ID da extensão; depois feche o Brave, abra novamente e recarregue a extensão em `brave://extensions`. Confirme **v1.13.0** no rodapé.

A suíte automatizada testa presets, argumentos seguros do yt-dlp/FFmpeg, links autorizados, fallback de autenticação e verificação dos arquivos de áudio. A compatibilidade real depende da fonte e deve ser conferida no navegador.

---

## Downloads grandes sem limite artificial de tamanho

- Os downloads MP4/WebM e HLS compatíveis são escritos progressivamente no armazenamento temporário **OPFS** do navegador. Não é mais necessário manter 96 MB ou 450 MB como teto de vídeo inteiro em memória.
- Para URLs MP4/WebM que exigem HTTP Range, o download grava intervalos de até 1–4 MB por vez, verificando `Content-Range` e total do arquivo para impedir arquivos incompletos.
- Para HLS VOD, os segmentos são gravados sequencialmente em disco e o arquivo final é repassado ao gerenciador de downloads do Chrome/Brave; o arquivo temporário é excluído quando a transferência termina.
- Não há promessa de espaço infinito: a transferência ainda depende de **cota OPFS, espaço livre do disco, compatibilidade do navegador, servidor e eventuais restrições de acesso**. Se OPFS não estiver disponível ou sua cota se esgotar, o usuário verá um erro explícito. O método nativo usa o disco diretamente.
- O antigo helper de montagem inteiramente em memória permanece limitado por segurança, mas deixou de ser a rota de download de vídeos grandes.

## Escolher qualidade de vídeo

- **HLS:** clique em **Consultar qualidades disponíveis** no card do stream para ler as variantes do manifesto; escolha uma das resoluções reais oferecidas ou mantenha **Automática**. A variante selecionada é validada novamente na master playlist antes de baixar. Opções com áudio separado não são tratadas como vídeo completo pelo downloader interno.
- **Assistente local (yt-dlp + FFmpeg):** selecione **Melhor disponível**, **2160p**, **1440p**, **1080p**, **720p**, **480p** ou **360p** antes de iniciar. O seletor usa um limite máximo de altura; se não existir uma faixa compatível, ele informa o erro e **não troca para uma resolução superior sem aviso**.
- Para um único MP4 direto, não existe uma escolha de qualidades se o servidor só disponibiliza aquele arquivo. Conversão/transcodificação não foi acrescentada.

## Atualização

Execute `git pull origin main`, recarregue a extensão em `brave://extensions` e atualize as abas abertas. Como `native/host.py` foi modificado para permitir escolher a resolução, execute novamente `native/install.ps1` com o ID da extensão e reinicie o Brave para usar os novos presets nativos.

Esta versão continua recusando DRM, criptografia HLS não suportada, arquivos fragmentados indevidamente e downloads sem autorização. Testes automatizados incluem gravação progressiva, integridade dos intervalos, validação de variantes e presets permitidos; o comportamento de armazenamento depende do navegador real.

---

## Correção dos downloads HLS e suporte opcional ao Pinterest

**Erro `Cannot read properties of undefined (reading 'download')`:** o documento auxiliar (offscreen) não dispõe da API `chrome.downloads`. Ele agora monta o Blob e pede ao service worker — que tem a permissão Downloads — para salvar o arquivo. O estado e o encerramento são acompanhados no service worker; a URL temporária é liberada quando o navegador conclui ou interrompe o download. Inclui proteção para conclusões que chegam antes do registro do Blob.

**Playlists com áudio separado:** o downloader HLS interno agora tenta escolher uma qualidade que tenha o áudio junto com o vídeo, quando existir. Se todas as qualidades possuem áudio separado, explica a necessidade do FFmpeg em vez de salvar um vídeo mudo ou incompleto. HLS com DRM, criptografia não suportada ou ausência de autorização continua indisponível.

**Pinterest:** as várias URLs `v1.pinimg.com` observadas podem ser rendições, qualidades e faixas do mesmo vídeo, não necessariamente servidores/arquivos independentes. Para evitar escolher o vídeo errado do feed, a extensão aceita o link exato do Pin (`https://www.pinterest.com/pin/<id>/`). Ela tenta identificá-lo próximo ao player ou permite colá-lo no cartão; ao solicitar o download, usa o yt-dlp e FFmpeg locais para conteúdo acessível e autorizado. Links de perfil, feed e busca não são aceitos como vídeo individual. Isso não garante disponibilidade de vídeos privados ou protegidos.

**TopAnimes:** o timeout apresentado indica ausência de resposta do servidor ao assistente, e não o mesmo erro de `chrome.downloads`. O limite e o diagnóstico permanecem; links HLS expirados ou bloqueados não são recuperados por meio de contorno de proteção.

### Atualização

Na pasta do projeto: `git pull origin main`, recarregue em `brave://extensions`, atualize a aba e confira **v1.11.0**. Como foi incluído o Pinterest no assistente Python, execute novamente `native/install.ps1` com o ID da extensão e reinicie completamente o Brave. Esse passo de recompilação só é necessário para a opção de download local por Pin; para o download HLS pelo navegador basta recarregar a extensão.

Os testes automatizados incluem chamadas offscreen→service worker, limpeza do Blob, escolha de qualidade HLS com áudio, e validação dos links específicos do Pinterest. Testes de reprodução final nos sites reais ainda dependem do navegador e de autorização dos servidores.

---

## Correção do HLS recusado por HTTP 403 no TopAnimes

Na versão anterior, o botão **Baixar stream** continuava usando o `fetch` do documento offscreen, mesmo quando essa requisição já tinha recebido HTTP 403. O card mostrava um segundo botão para o assistente local, mas a ação principal fazia o usuário repetir o erro.

A versão **1.10.2** usa uma política explícita de escolha de método:

- **Playlist HLS identificada no par TopAnimes/CDN conhecido:** a ação principal é **Baixar com assistente local**, enviando somente a fonte já observada e a referência da página. O botão duplicado é removido.
- **HLS de outros sites:** mantém o fluxo de download no navegador quando o servidor permite, respeitando erros de autorização e DRM.
- **URL temporária expirada:** a ação de baixar fica desabilitada e a extensão solicita atualizar a reprodução para receber um link novo. O parâmetro `expires` é reconhecido em segundos ou milissegundos.
- **Estado antigo de erro:** ao atualizar da v1.10.1, o erro de playlist recusada do método navegador é limpo sem apagar a lista de mídias.

A política de origens admitidas permanece restrita no assistente. Uma resposta HTTP 403 também pode ocorrer no yt-dlp: nesse caso o servidor ainda não permitiu a transferência, e o programa explica a falha em vez de afirmar que realizou o download. Não há remoção de DRM ou contorno de desafios de proteção.

### Atualizar

Execute `git pull origin main`, abra `brave://extensions` e clique em **Recarregar**. Atualize também a página do episódio para obter fontes recentes. Confira **v1.10.2** no rodapé. **Não é necessário recompilar `mediafinder_native.exe`**: somente arquivos da extensão foram modificados.

Os testes incluem roteamento entre navegador e assistente local, validade do par página/CDN, links assinados de 10/13 dígitos e HLS com timeout/HTTP 403. A verificação no servidor real deve ser feita pelo usuário, pois autorização e disponibilidade mudam.

---

## Correção do erro "Failed to execute 'fetch' on 'Window': Illegal invocation"

O downloader HLS estava recebendo a função nativa `fetch` e invocando-a como método da instância `StreamDownloader`. Em navegadores Chromium, isso causa **Illegal invocation** antes mesmo de ler a playlist. A chamada foi corrigida para preservar o contexto do navegador, tanto para playlists quanto para segmentos TS.

A versão contém testes de regressão simulando a exigência do contexto do `fetch` do navegador e testes da injeção de cliente HTTP. Os controles de tempo, erros 401/403, links expirados e download nativo opcional continuam ativos.

**Instalação:** execute `git pull origin main` no diretório da extensão, abra `brave://extensions`, clique em **Recarregar** e atualize a aba com o vídeo. Confira `v1.10.1` no rodapé. **Não é necessário executar `native/install.ps1` ou recompilar o executável:** os arquivos Python não mudaram.

A atualização corrige um bug local de execução, mas não transforma uma resposta HTTP 403 em autorização de download. Vídeos HLS protegidos ou indisponíveis continuarão apresentando erro.

---

## Correções de estabilidade para sites de vídeo

- **Downloads travados:** o assistente local agora envia atividade durante a espera pela resposta e encerra processos que ficarem 120 segundos sem atividade. Também estabelece limite máximo de 45 minutos por tentativa, retries de rede limitados e cancelamento com término dos processos relacionados.
- **HLS com HTTP 403:** uma playlist que responde com 200 ao player pode responder 403 ao downloader executado em outro contexto. A extensão identifica essa diferença, não insiste repetidamente em uma resposta recusada e apresenta uma alternativa manual quando disponível.
- **TopAnimes (par conhecido):** para playlists HLS observadas na aba `topanimes.net` no host `doce-de-leite-vegano.b-cdn.net`, foi adicionada a opção **Tentar playlist via assistente local** usando a página original como referência. Essa tentativa depende da autorização do CDN: não remove DRM, não resolve CAPTCHA e não ignora bloqueios de acesso.
- **Links HLS temporários:** URLs com o parâmetro `expires` em formato de timestamp conhecido são identificadas como expiradas quando aplicável. Atualize a página para renovar links expirados.
- **MP4 do SushiAnimes:** manteve a tentativa contextual já existente, mas sem carregamento indefinido. O HTML fornecido pelo usuário confirma uma URL MP4 em um JW Player; não confirma que o servidor autorize download separado.
- **Cancelamento:** downloads MP4/HLS e trabalhos nativos agora recebem a solicitação de cancelamento; o assistente encerra os processos associados e o popup atualiza o estado.

### Como atualizar

No diretório do projeto, execute `git pull origin main`, recarregue a extensão e a aba no Brave. Como o executável nativo foi alterado, execute novamente `native/install.ps1` com o mesmo ID da extensão para recompilar o assistente local, feche e reabra o navegador. Confirme **v1.10.0** no rodapé.

Para validar: abra o player, escolha a aba **Vídeos**, use o botão nativo contextual da fonte identificada. Se o CDN negar acesso (403), a extensão encerrará a tentativa informando o bloqueio. Não é garantido que a mídia disponível para streaming incorporado possa ser obtida como arquivo.

Os testes automáticos verificam parsing HLS, erros HTTP, timeout de requisições, links expirados, seleção de pares de origem permitidos e watchdog do processo nativo. Testes reais nos dois sites dependem da sessão do usuário e não são simulados como sucesso.

---

## Correção: sessão do Brave não pode ser lida

A versão 1.9 não tenta quebrar a criptografia de cookies do navegador. Em vez disso, oferece três modos **por download**:

- **Sem sessão (padrão)**: recomendado para Reels e vídeos públicos. O yt-dlp tenta baixar diretamente sem ler credenciais locais.
- **Brave (opcional)**: solicita ao yt-dlp ler a sessão do Brave somente com seleção explícita. Se a leitura falhar por bloqueio, DPAPI ou criptografia, a extensão informa a falha e tenta o vídeo público sem cookies.
- **Firefox (opcional)**: se o Firefox estiver instalado e autenticado na plataforma, permite uma leitura autorizada da sessão desse navegador usando a interface suportada do yt-dlp. Não é necessário instalar Firefox para usar o modo público.

Quando o vídeo exigir autenticação e a sessão escolhida não puder ser lida, o download permanecerá indisponível. A extensão não modifica as proteções do navegador nem garante acesso a publicações privadas. O erro passa a explicar se ocorreu bloqueio de cookies, exigência de login ou recusa do servidor.

**Atualização:** execute `git pull origin main` e recarregue a extensão em `brave://extensions`. Como `native/host.py` mudou, rode novamente `native/install.ps1` com seu ID de extensão, para recompilar `mediafinder_native.exe`; então reinicie o Brave.

Os downloads locais passam por FFprobe antes de serem classificados como concluídos. A interface não mostra tokens ou cookies; os comandos são iniciados somente quando o usuário solicita a transferência.

---

## Nova implementação: links específicos e CDN de mídia

**Instagram:** se o Reel reproduz no feed, mas o player tem `src="blob:..."` sem permalink identificável, use **Compartilhar → Copiar link** na publicação e cole no campo do card. O botão envia **somente** um link válido de Reel/post ao assistente. Quando o link já é identificado na página, não é necessário colá-lo. Para publicações que exigem autenticação, a leitura da sessão do Brave permanece **opcional e com consentimento explícito**. Essa alternativa não remove DRM nem contorna bloqueios de autenticação.

**Sites com player HTML5:** a extensão distingue a mídia pedida pelo próprio player (status da requisição e origem) de um link acessado fora do site. No caso testado, `sushianimes.com.br` → `cdn-s01.pixel-sus-4k-image.com`, há uma opção **Tentar download pela página de origem**: o assistente pode solicitar a URL com a referência normal da página original. Isso não executa CAPTCHA, não altera mecanismos de proteção, não lê cookies do CDN e **não garante** contornar HTTP 403 ou políticas do servidor. Por segurança, essa tentativa adicional está limitada ao par de hosts verificado no projeto.

As URLs precisam corresponder a mídias observadas na aba; a extensão não usa um URL genérico de outra postagem, nem salva uma página de erro como se fosse vídeo. Os caminhos HLS/DASH/DRM continuam com suas limitações técnicas.

**Importante:** após `git pull origin main`, recarregue a extensão em `brave://extensions` e **recompile o assistente local** com `native/install.ps1`, pois o executável `mediafinder_native.exe` não muda com o `git pull`. Reinicie o Brave. Confirme **v1.8.0** no rodapé da extensão.

---

## Correção: Instagram retorna “Unsupported URL” ou exige cookies

Na versão anterior, o assistente recebia `https://www.instagram.com/` quando um vídeo aparecia no feed. Esse endereço não identifica um Reel. Na v1.7 a extensão procura um link **único e específico** de publicação junto ao player; caso contrário, desabilita o download e orienta abrir o Reel/post em sua página `/reel/...` ou `/p/...`. Nunca seleciona automaticamente um vídeo aleatório do feed.

Para posts que exigem login, há a opção **Usar sessão do Brave neste download**. Ela só é ativada após marcar a caixa e permite ao yt-dlp tentar ler cookies locais do Brave. **Essa opção dá acesso temporário à sessão autenticada para a ferramenta local**, deve ser usada apenas em conteúdos que você tem permissão para baixar, e pode falhar devido à proteção de cookies do Brave no Windows. Nenhum cookie é enviado pelo protocolo de mensagens da extensão ao assistente.

**O arquivo `mediafinder_native.exe` já instalado não se atualiza com `git pull`.** Depois de atualizar o projeto, execute novamente `native/install.ps1` com o mesmo ID da extensão e reinicie o navegador.


## Novo na v1.6: baixar de um player MSE/blob

Ao encontrar o vídeo no Instagram, o card **PLAYER / MSE / blob** agora apresenta duas ações:

- **Buscar fontes de download:** abre possíveis URLs MP4/HLS observadas na mesma aba, informando claramente que elas podem pertencer a outra mídia do feed. Ao selecionar uma fonte direta, ela passa por verificação antes de baixar.
- **Baixar completo com assistente local:** opção para Instagram/YouTube com [assistente nativo](native/README.md), usando **yt-dlp + FFmpeg** quando o navegador só dispõe de faixas adaptativas de áudio e vídeo. É opcional e exige uma instalação manual no computador.

### MP4 disponibilizado em intervalos de bytes

Quando um servidor retorna apenas os primeiros 1.000 bytes com `HTTP 206` e informa o **Content-Range total**, a extensão verifica se esses bytes são o cabeçalho de um MP4/WebM e tenta solicitar **todos os intervalos do mesmo arquivo**. Cada segmento precisa responder com offset, limite e tamanho total coerentes. O arquivo montado é validado (contêiner e duração) antes de ser salvo. O limite atual é **96 MiB**, com recusa se algum intervalo estiver ausente ou se a fonte usar fragmentos de recursos independentes.

Essa montagem de intervalos não substitui um muxer de áudio/vídeo separado nem serve para DRM. URLs do feed não são garantidamente do player atual; confira a fonte.

### Instalação

Atualize a pasta do projeto com `git pull origin main`, recarregue a extensão e a aba no Chrome/Brave, e confirme **v1.6.0** no rodapé. Para instalar a opção de streaming com FFmpeg, siga [native/README.md](native/README.md) e informe o ID da extensão ao instalador. Sem o assistente, a detecção e os downloads diretos continuam funcionando.

**Status de validação:** os testes automatizados cobrem intervalos, rejeição de respostas incompatíveis e parâmetros de segurança do assistente. Ainda é necessário testar um Reel e um vídeo real do YouTube no seu navegador, com suas próprias permissões de acesso.

---

## O que mudou na versão 1.5

**Detectar um player não é o mesmo que ter um arquivo para download.** A extensão agora informa as duas situações separadamente:

- **Instagram/Reels:** identifica elementos `<video>` cuja fonte é `blob:`, sem salvar `blob:` ou o endereço da página como falso MP4. Também reconhece páginas `/reel/...` enquanto o player ainda está carregando.
- **YouTube:** detecta o vídeo atual em páginas de reprodução, inclusive após navegação dinâmica. Um detector somente de leitura consulta os metadados disponíveis na página para mostrar título, duração e quantidades de faixas adaptativas de áudio/vídeo.
- **Progressivo completo:** quando o player do YouTube disponibiliza uma URL explícita de vídeo **com áudio** e sem exigir decifrar assinaturas, ela é listada separadamente e passa pelas mesmas verificações de download direto existentes.
- **Fontes fragmentadas/adaptativas:** são informadas como players/faixas detectados, **não como arquivos completos**. Não há tentativa de baixar `blob:`, de juntar faixas sem um muxer ou de contornar DRM.
- **Miniaturas:** permanecem na aba Imagens e não são apresentadas como se fossem o vídeo.
- **Interface:** mostra “Vídeo identificado” e a origem do player, e só habilita o download quando existe uma fonte direta elegível.

**Testes:** `npm test` cobre fontes `blob:` e os metadados do YouTube usando cenários simulados. Ainda é necessário validar a extensão instalada nos sites reais, já que seus players mudam frequentemente.

**Atualização:** execute `git pull origin main`, recarregue a extensão em `chrome://extensions` e atualize as abas já abertas. Confira **v1.5.0** no popup. O detector do YouTube usa um content script no contexto da página (`MAIN`) apenas para leitura de metadados; nenhum dado é enviado a servidores externos pela extensão.

**Limite atual:** reconhecer o player do YouTube ou do Instagram não garante conseguir baixar o vídeo. Quando o site oferece apenas DASH/MSE ou faixas separadas, falta implementar um muxer/gerenciador de stream para produzir arquivos completos.

---

Extensão Chrome (Manifest V3) para detectar **vídeos, imagens e áudios**, com interface focada no conteúdo da página.

## Verificação inteligente antes do download (v1.4)

A extensão não considera uma resposta HTTP `video/mp4` como prova de vídeo completo.

1. Registra `Content-Type`, `Content-Length`, `Content-Range` e status HTTP das fontes capturadas.
2. Ao abrir o popup, verifica automaticamente até duas fontes em destaque. Ao baixar uma fonte direta, sempre confere novamente a disponibilidade (com cache curto).
3. Faz uma requisição GET limitada a 512 KiB para conferir a resposta real e a assinatura binária do arquivo. HTTP 206 com faixa incompleta, HTML/JSON, links expirados, fMP4 isolado e MP4 de inicialização são bloqueados.
4. MP4 e WebM com tamanho conhecido de até **96 MiB** são baixados temporariamente no documento offscreen. A extensão confere tamanho, estrutura e metadados de duração antes de salvar. Isso não depende de assistir ao vídeo. Quando a página informa a duração, também identifica arquivos muito mais curtos que o vídeo esperado.
5. Para vídeos maiores, a extensão usa o Chrome Downloads após o pré-teste e confere o tamanho transferido informado pelo navegador. Essa rota **não comprova reprodução completa** e continua exibindo diagnóstico cauteloso.
6. Fontes sem tamanho conhecido ou cuja estrutura não pôde ser validada ficam como **não confirmadas**: a extensão não oferece um botão que prometa vídeo completo.

Resultado na interface: **Download provável**, **Resposta 206**, **Fragmento / indisponível**, **Não confirmado** ou **Verificar e baixar**. A verificação evita downloads enganosos mas não recupera automaticamente trechos faltantes.

**YouTube:** costuma disponibilizar áudio e vídeo em fluxos adaptativos separados; o MVP atual não faz o mux desses fluxos e, por isso, não promete download completo. O mesmo vale para DASH/DRM e serviços que exigem sessão/referer indisponíveis na extensão.

### Atualização importante no navegador

A versão carregada pode continuar antiga mesmo depois de atualizar o GitHub. Confira a versão **1.4.0** em `chrome://extensions`. Clique em **Recarregar** na extensão e **recarregue a aba do site**. Se a interface exibir `v1.2.0`, o navegador ainda está usando uma cópia antiga.

## O que mudou na 1.3

- Interface renovada: abas **Vídeos / Imagens / Áudios**, cartões compactos, prévias quando disponíveis e botões de download por item.
- Prioridade para mídia visível e identificada no DOM da página, incluindo algumas páginas com players incorporados.
- Fontes detectadas exclusivamente pela rede aparecem de forma resumida (até 2 inicialmente) e as demais ficam em **Ver outras fontes**. Isso evita exibir uma lista enorme de recursos de feed como se fossem todos vídeos da postagem atual.
- URLs de arquivos iguais são agrupadas por identidade da mídia quando é seguro fazer isso. Links assinados são preservados integralmente para o download.
- As imagens da página são detectadas pelo DOM com filtros de tamanho para evitar dezenas de ícones e avatares. As imagens requisitadas pela rede **não** são adicionadas indiscriminadamente.
- Botões de download para arquivos diretos MP4/WebM, JPG/PNG/WebP/AVIF e formatos comuns de áudio, dependendo da origem.
- Acompanhamento do estado do gerenciador de downloads do Chrome; tratamento de cancelamento.
- Playlists **HLS VOD sem criptografia** continuam sendo processadas fora do popup, com progresso e formato original.

## Instagram e páginas de feed

O Instagram pode carregar várias mídias automaticamente, incluindo prévias e vídeos de outras publicações. A extensão agora mostra preferencialmente mídias **visíveis na aba**. Quando não há URL direta associável ao player, mostra até 2 **possíveis arquivos** identificados nas requisições e mantém os demais recolhidos.

**Limitação importante:** não há como afirmar, apenas observando 75 respostas HTTP, que são 75 vídeos diferentes ou que todas fazem parte da mesma postagem. A interface não faz essa associação sem evidência. Fontes adicionais continuam acessíveis, para você escolher manualmente quando necessário.

## Instalação/atualização

1. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
2. Faça `git pull origin main` na pasta do projeto, ou baixe a versão atualizada.
3. Se a extensão já está instalada, clique no botão **Recarregar** dela.
4. Atualize também a aba do Instagram/site, para que o novo detector seja injetado.
5. Clique na extensão, selecione **Vídeos**, **Imagens** ou **Áudios** e clique em **Baixar**.
6. Use **↻** para procurar fontes novamente ou **⌫** para limpar a lista e refazer a busca.

Em uma atualização direta da versão 1.2, a extensão limpa a lista antiga para não reapresentar dezenas de entradas sem informações de origem.

## Limites técnicos

- Downloads diretos dependem de o servidor disponibilizar um URL de arquivo completo. A validação reduz arquivos quebrados, mas não reconstrói fluxos fragmentados automaticamente.
- Vídeos com DRM (como Widevine), protegidos por licença ou que não disponibilizem arquivos acessíveis não são suportados.
- O DASH/MPD é detectado, porém baixar e muxar corretamente áudio e vídeo ainda é uma implementação futura.
- HLS de transmissões ao vivo, arquivos criptografados, faixas de áudio separadas ou playlists com descontinuidades não é suportado. Fluxos TS são salvos como `.ts`, não falsamente renomeados para `.mp4`.
- O processo HLS ainda possui limite de 450 MiB em memória; não suporta retomada após reinício do navegador.
- Imagens pequenas (ícones, avatares e similares) são omitidas intencionalmente para diminuir ruído.
- Sites podem exigir iniciar a reprodução para revelar a URL. Não há suporte universal a todos os players.

Use a extensão somente para baixar conteúdos que você tem permissão de obter.

## Testes

Requer Node.js 20+:

```bash
npm test
```

Os testes cobrem parsing HLS, reconhecimento de tipos, segurança das extensões, deduplicação de URLs, ordenação dos resultados, Content-Range, assinaturas de mídia e detecção de MP4 de 1 KB / 313 KB sem dados de vídeo. A automação está em `.github/workflows/tests.yml`.

## Próximas melhorias

- Muxing independente do assistente local para formatos compatíveis com Manifest V3.

- Associação mais precisa entre players e URLs de rede em aplicações com `blob:`.
- Muxing de HLS com áudio separado e TS → MP4.
- Suporte DASH com `SegmentTemplate`, `SegmentTimeline` e áudio/vídeo.
- Transferência em streaming para disco e downloads com retomada.
