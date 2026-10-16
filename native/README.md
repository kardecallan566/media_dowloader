# Assistente local opcional (Windows / Chrome / Brave)

O Media Finder Pro funciona sozinho para URLs de arquivo e HLS VOD compatíveis. Para páginas que apenas oferecem um player `blob:/MSE` ou vídeo/áudio separados, o **assistente local opcional** pode tentar obter o arquivo original e montar vídeo + áudio corretamente com **yt-dlp + FFmpeg**.

Ele **não** captura/grava a reprodução, não remove DRM, não usa cookies automaticamente e não consegue garantir todos os vídeos. Funciona inicialmente com URLs HTTPS do Instagram, YouTube e YouTube Shorts que estejam acessíveis para o usuário.

## Pré-requisitos

- Windows, Brave ou Chrome, Python 3.10+ com o launcher `py`.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) e [FFmpeg](https://ffmpeg.org/), acessíveis no PATH.
- [PyInstaller](https://pyinstaller.org/) (o script instala com pip se necessário).

Para quem utiliza Scoop:

```powershell
scoop install yt-dlp ffmpeg
```

Feche e reabra o navegador após instalar esses programas, para atualizar seu PATH.

## Instalação

1. Atualize o repositório para v1.6.0, depois abra `brave://extensions` ou `chrome://extensions`.
2. Ative o **Modo do desenvolvedor**, procure Media Finder Pro e copie o **ID da extensão** (32 letras). É o identificador do pacote carregado, não a URL do vídeo.
3. Abra um terminal PowerShell **no diretório do repositório** e execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\native\install.ps1 -ExtensionId COLE_AQUI_O_ID_DA_EXTENSAO
```

4. O instalador compila `native/host.py` localmente para `native/dist/mediafinder_native.exe`, registra um arquivo Native Messaging em `HKCU` para Chrome/Brave e limita a conexão ao ID da extensão que você informou. Não precisa de privilégios administrativos.
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

## Solução de problemas

- Verifique `yt-dlp --version` e `ffmpeg -version` no terminal.
- Confirme que o ID passado ao instalador corresponde ao ID em `brave://extensions`.
- Rode novamente `native/install.ps1` após atualizar ou mover o projeto.
- Reinicie o navegador por completo após registrar o host.
- Se o host informar que não encontra yt-dlp/ffmpeg, confirme o PATH do processo do navegador.
