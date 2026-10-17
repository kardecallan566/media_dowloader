# Assistente local · v1.14.0

## Playlist inteira do YouTube — somente áudio

O Native Messaging Host agora aceita `downloadPlaylistAudio` com URL canônica `https://www.youtube.com/playlist?list=...`, perfil de áudio permitido e sessão opcional. O yt-dlp recebe `--yes-playlist`, `--ignore-errors`, `--continue`, `--download-archive` e os parâmetros de extração já utilizados para áudios individuais.

Cada playlist e perfil tem uma pasta `Downloads/MediaFinder/Playlists/<id>/<perfil>/`, com histórico persistente próprio, para baixar apenas as faixas pendentes na próxima execução. A saída é verificada como áudio com FFprobe após a conversão. Não são usados argumentos arbitrários vindos de websites; os links são validados novamente no assistente.

Ao atualizar, rode **novamente** `native/install.ps1` com o ID da extensão para recompilar o executável. O Chrome/Brave precisa estar aberto durante o lote. O cancelamento encerra o processo e uma nova tentativa utiliza o histórico dos itens concluídos.

---

## Exportação de áudio dos vídeos

O Native Messaging Host aceita `audioProfile` com valores permitidos exclusivamente `mp3-128`, `mp3-192`, `mp3-320`, `m4a` ou `opus`. Quando presente, o assistente solicita uma faixa de áudio com `yt-dlp --format bestaudio/best --extract-audio`, converte pelo FFmpeg para o formato escolhido e verifica o resultado com FFprobe. Nenhum argumento arbitrário informado pela página pode ser executado.

O modo de vídeo continua separado, e a função de áudio não altera a seleção de resoluções 360p–2160p. Para publicações com autenticação, os cookies de Brave/Firefox só são solicitados com escolha explícita. Os domínios/URLs permitidos permanecem limitados aos já reconhecidos; recusas de acesso ou DRM não são contornados.

**Após atualizar**, execute novamente `native/install.ps1` com o ID do Media Finder Pro para recompilar `mediafinder_native.exe`. Em seguida, reinicie o Brave. O áudio concluído aparece em `Downloads/MediaFinder`.

---

Os downloads locais agora aceitam uma opção de qualidade: `best` (melhor disponível), `2160`, `1440`, `1080`, `720`, `480` ou `360`. Estes números são limites superiores de resolução aplicados às faixas existentes. A ferramenta não amplia artificialmente o vídeo nem escolhe qualidade superior quando a selecionada não está disponível.

O assistente yt-dlp/FFmpeg baixa diretamente para o disco, sem usar o limite de memória da extensão. A tentativa continua sujeita a espaço disponível, disponibilidade da fonte e autorização do site. Como o executável nativo mudou, execute o instalador novamente após `git pull` para recompilá-lo e reinicie o navegador.

---

A versão 1.11.0 permite, de forma opcional, tentar baixar vídeos de Pins individuais por `yt-dlp` + `FFmpeg`. Aceita somente o caminho `/pin/<número>/` dos domínios oficiais do Pinterest. **Não aceita a página inicial, pesquisa nem o perfil como URL de vídeo**. Nenhuma sessão é lida por padrão; a extensão só usa cookies se o usuário escolher explicitamente essa opção.

Como `native/host.py` mudou, após `git pull origin main` execute novamente `native/install.ps1` com o ID da extensão e reinicie o Brave. O helper continua sem mecanismo de remoção de DRM e respeita recusas de acesso.

---

**A versão nova do código Python precisa ser recompilada**: `git pull origin main` → `powershell -ExecutionPolicy Bypass -File .\native\install.ps1 -ExtensionId SEU_ID` → reiniciar Brave.

O assistente agora encerra downloads sem resposta por 2 minutos, emite mensagens de espera e possui cancelamento mais confiável. Para a playlist HLS observada em TopAnimes, aceita explicitamente a combinação site/CDN identificada e tenta o download com `Referer` original, sem cookies de outros sites e sem remover DRM. HTTP 403 permanece um erro se o servidor negar a requisição. Não forneça links assinados a terceiros.

---

O Media Finder Pro funciona sozinho para URLs de arquivo e HLS VOD compatíveis. Para páginas que apenas oferecem um player `blob:/MSE` ou vídeo/áudio separados, o **assistente local opcional** pode tentar obter o arquivo original e montar vídeo + áudio corretamente com **yt-dlp + FFmpeg**.

Ele **não** captura/grava a reprodução, não remove DRM e não consegue garantir todos os vídeos. O acesso a cookies é **opcional e depende de seleção explícita a cada download**; o padrão agora é **Sem sessão**. São suportadas tentativas com Brave ou Firefox. Funciona inicialmente com URLs HTTPS do Instagram, YouTube e YouTube Shorts que estejam acessíveis para o usuário.

## Pré-requisitos

- Windows, Brave ou Chrome e Python 3.10+ (`python` pelo Scoop **ou** launcher `py` tradicional). O instalador identifica ambos.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) e [FFmpeg](https://ffmpeg.org/), acessíveis no PATH.
- [PyInstaller](https://pyinstaller.org/) é instalado **automaticamente** em um ambiente isolado criado pelo script em `native/.build-venv`. Não precisa criar nem ativar `.venv`.

Para quem utiliza Scoop:

```powershell
scoop install python yt-dlp ffmpeg
```

Após instalar o Python, reabra o **terminal** para atualizar o PATH. Confirme com `python --version` e `python -m pip --version`. Depois da instalação do assistente, reinicie também o navegador.

## Instalação

1. Atualize o repositório para v1.6.0, depois abra `brave://extensions` ou `chrome://extensions`.
2. Ative o **Modo do desenvolvedor**, procure Media Finder Pro e copie o **ID da extensão** (32 letras). É o identificador do pacote carregado, não a URL do vídeo.
3. No diretório do repositório, execute `git pull origin main` para receber a correção do instalador e então rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\native\install.ps1 -ExtensionId COLE_AQUI_O_ID_DA_EXTENSAO
```

4. O script escolhe automaticamente `python` ou `py`, cria um ambiente de compilação isolado sem exigir ativação manual e então compila `native/host.py` localmente para `native/dist/mediafinder_native.exe`, registra um arquivo Native Messaging em `HKCU` para Chrome/Brave e limita a conexão ao ID da extensão que você informou. Não precisa de privilégios administrativos.
5. Após toda atualização do código do assistente (`native/host.py`), execute novamente o instalador para **recompilar o EXE**: `git pull origin main` e o comando de instalação acima. Reinicie completamente o Brave/Chrome, atualize a aba e abra a extensão.
6. No Instagram, primeiro abra a publicação/Reel em seu link próprio (ex.: `https://www.instagram.com/reel/ABC123/`). A homepage `instagram.com/` e páginas de perfil não são URLs de vídeo válidas. Em seguida, clique em **Baixar publicação com assistente local**. Os arquivos produzidos ficam em `Downloads/MediaFinder`.

**A instalação é opcional.** Sem o assistente, o botão informa um erro de conexão e os downloads diretos da extensão continuam funcionando.

## Privacidade e segurança

- Não há servidor HTTP local, credenciais de API nem coleta externa de dados da extensão.
- O navegador comunica-se apenas com o executável registrado por Native Messaging; o host aceita comandos com URLs HTTPS de Instagram/YouTube.
- O usuário inicia cada tentativa manualmente. O host só executa yt-dlp/FFmpeg com uma lista fixa de argumentos, **sem shell**.
- **Sem sessão** é o padrão e não lê cookies. Para uma sessão autenticada, selecione explicitamente **Brave** ou **Firefox** na extensão. O yt-dlp tenta a interface oficial `--cookies-from-browser` com o navegador escolhido.
- Quando houver erro de leitura da sessão (proteção de cookies, DPAPI ou banco indisponível), o assistente comunica a falha e tenta novamente sem cookies. Isso funciona apenas para conteúdo público acessível; publicações privadas podem continuar indisponíveis.
- A extensão não copia cookies, não modifica as proteções do Brave e não extrai sessões sem consentimento.
- O host e as dependências se conectam às plataformas para obter mídia, sujeitos aos controles de acesso e direitos aplicáveis.
- Use somente vídeos que você pode baixar. Vídeos com DRM, conteúdo não disponibilizado ao usuário ou bloqueios de acesso não são contornados.

## Limites

- Se o vídeo exige login, tente um navegador no qual você esteja autenticado (Brave ou Firefox), **somente com seleção explícita**. No Windows, o Brave pode impedir a extração de cookies e essa proteção não será contornada. Tentar sem cookies só funciona para vídeos públicos.
- A instalação precisa ser repetida se o ID da extensão mudar, por exemplo ao carregar o projeto de outra pasta.
- Atualizações de Instagram/YouTube podem exigir nova versão do yt-dlp: `scoop update yt-dlp`.
- Downloads grandes consomem armazenamento e podem falhar; a lógica do host informa o erro.
- Este recurso é um **componente nativo adicional**, não um download DASH autônomo implementado inteiramente dentro do navegador.

## Erro `py` ou `.venv` não encontrado

Versões antigas do `install.ps1` só aceitavam o comando `py`. Se você instalou Python pelo Scoop, `python` pode funcionar perfeitamente sem existir `py`. Execute `git pull origin main` para receber a versão corrigida, instale Python pelo Scoop se necessário e repita o comando de instalação. A pasta `.venv` não precisa existir; o script cria `native/.build-venv` automaticamente.

Se o PowerShell mostrar caracteres estranhos como `nÃ£o`, isso é apenas uma diferença de codificação do terminal. O instalador atualizado usa mensagens ASCII para evitar esse problema.

## Nova tentativa contextual (versão 1.8)

Quando o site original autoriza a reprodução incorporada, o vídeo pode estar disponível somente na sessão/contexto daquela página. A extensão oferece uma tentativa manual, restrita ao par `sushianimes.com.br` e `cdn-s01.pixel-sus-4k-image.com`, transmitindo ao yt-dlp o endereço da página de origem como `Referer`. Se houver um bloqueio HTTP 403 ou desafio de proteção do servidor, não há tentativa de contornar a restrição: a falha é comunicada.

Para Instagram, se o player aparece no feed mas não tem URL específica, copie o link de compartilhamento do Reel/post e cole no campo da extensão. O assistente aceita somente permalinks válidos.

**Recompile o assistente após atualizar o repositório**, executando novamente o instalador; `git pull` não recompila o executável.

## Diagnóstico do Instagram

- **Unsupported URL: https://www.instagram.com/**: abra a postagem/Reel para obter um link /reel/... ou /p/...; o assistente 1.7 bloqueia essa tentativa antes de chamar o yt-dlp.
- **Login required / cookies**: o download sem autenticação não foi permitido. Com sua autorização, marque a opção de sessão do Brave naquele download. O navegador pode bloquear a leitura dos cookies.
- **Aparece o erro antigo apesar do código novo**: `git pull origin main` não recompila o executável instalado. Execute novamente `native/install.ps1` e feche/reabra o Brave.
- Se o link da publicação não puder ser associado unicamente ao player do feed, a extensão não tenta adivinhar.

## Solução de problemas

- Verifique `yt-dlp --version` e `ffmpeg -version` no terminal.
- Confirme que o ID passado ao instalador corresponde ao ID em `brave://extensions`.
- Rode novamente `native/install.ps1` após atualizar ou mover o projeto.
- Reinicie o navegador por completo após registrar o host.
- Se o host informar que não encontra yt-dlp/ffmpeg, confirme o PATH do processo do navegador.
