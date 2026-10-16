# Assistente local opcional (Windows / Chrome / Brave)

O Media Finder Pro funciona sozinho para URLs de arquivo e HLS VOD compatíveis. Para páginas que apenas oferecem um player `blob:/MSE` ou vídeo/áudio separados, o **assistente local opcional** pode tentar obter o arquivo original e montar vídeo + áudio corretamente com **yt-dlp + FFmpeg**.

Ele **não** captura/grava a reprodução, não remove DRM, não usa cookies automaticamente e não consegue garantir todos os vídeos. Funciona inicialmente com URLs HTTPS do Instagram, YouTube e YouTube Shorts que estejam acessíveis para o usuário.

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
5. Reinicie completamente o Brave/Chrome, atualize a aba e abra a extensão.
6. Em um player detectado do Instagram/YouTube, clique em **Baixar completo com assistente local**. Os arquivos produzidos ficam em `Downloads/MediaFinder`.

**A instalação é opcional.** Sem o assistente, o botão informa um erro de conexão e os downloads diretos da extensão continuam funcionando.

## Privacidade e segurança

- Não há servidor HTTP local, credenciais de API nem coleta externa de dados da extensão.
- O navegador comunica-se apenas com o executável registrado por Native Messaging; o host aceita comandos com URLs HTTPS de Instagram/YouTube.
- O usuário inicia cada tentativa manualmente. O host só executa yt-dlp/FFmpeg com uma lista fixa de argumentos, **sem shell**.
- Não são carregados cookies do navegador, credenciais ou dados de login automaticamente.
- O host e as dependências se conectam às plataformas para obter mídia, sujeitos aos controles de acesso e direitos aplicáveis.
- Use somente vídeos que você pode baixar. Vídeos com DRM, conteúdo não disponibilizado ao usuário ou bloqueios de acesso não são contornados.

## Limites

- Se um vídeo exige sessão autenticada, não há suporte a importação automática de cookies. O host pode não conseguir baixá-lo.
- A instalação precisa ser repetida se o ID da extensão mudar, por exemplo ao carregar o projeto de outra pasta.
- Atualizações de Instagram/YouTube podem exigir nova versão do yt-dlp: `scoop update yt-dlp`.
- Downloads grandes consomem armazenamento e podem falhar; a lógica do host informa o erro.
- Este recurso é um **componente nativo adicional**, não um download DASH autônomo implementado inteiramente dentro do navegador.

## Erro `py` ou `.venv` não encontrado

Versões antigas do `install.ps1` só aceitavam o comando `py`. Se você instalou Python pelo Scoop, `python` pode funcionar perfeitamente sem existir `py`. Execute `git pull origin main` para receber a versão corrigida, instale Python pelo Scoop se necessário e repita o comando de instalação. A pasta `.venv` não precisa existir; o script cria `native/.build-venv` automaticamente.

Se o PowerShell mostrar caracteres estranhos como `nÃ£o`, isso é apenas uma diferença de codificação do terminal. O instalador atualizado usa mensagens ASCII para evitar esse problema.

## Solução de problemas

- Verifique `yt-dlp --version` e `ffmpeg -version` no terminal.
- Confirme que o ID passado ao instalador corresponde ao ID em `brave://extensions`.
- Rode novamente `native/install.ps1` após atualizar ou mover o projeto.
- Reinicie o navegador por completo após registrar o host.
- Se o host informar que não encontra yt-dlp/ffmpeg, confirme o PATH do processo do navegador.
