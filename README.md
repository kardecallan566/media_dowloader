# Media Finder – Extensão de Navegador (Legal e sem DRM)

Uma extensão de navegador (Manifest V3) que detecta mídias de vídeo e áudio em páginas web e oferece opções de download ou gravação quando permitido. **Não contorna DRM (Widevine/EME)** e deve ser usada **somente para conteúdos de uso legal**.

---

## 📂 Estrutura do projeto

```
media-downloader/
├─ manifest.json
├─ background.js
├─ content.js
├─ popup.html
├─ popup.js
└─ icons/
   ├─ icon16.png
   ├─ icon48.png
   └─ icon128.png
```

---

## ⚙️ Funcionalidades

* Detecta URLs de mídia em páginas (vídeo/áudio HTML5).
* Lista as mídias detectadas no popup da extensão.
* Opções para **abrir** a mídia em nova aba ou **baixar** diretamente (quando disponível).
* Injeta botões sobre `<video>` da página para:

  * **Baixar o `src` direto** (se permitido pelo servidor).
  * **Gravar alguns segundos** do vídeo em reprodução com `MediaRecorder` (não funciona em vídeos com DRM).

---

## 🚀 Instalação (Chrome, Edge, Brave)

1. Clone ou baixe este repositório.
2. Abra `chrome://extensions/`.
3. Ative **Modo do Programador**.
4. Clique em **Carregar sem compactação** e selecione a pasta `media-downloader`.

---

## 🖥️ Como usar

1. Acesse um site que contenha vídeo ou áudio HTML5.
2. Reproduza a mídia.
3. Clique no ícone da extensão para visualizar as mídias detectadas.
4. Clique em **Abrir** ou **Baixar**.
5. Também é possível usar o botão injetado no player `<video>` para baixar ou gravar.

---

## ⚠️ Limitações

* Não baixa conteúdos protegidos por DRM (ex.: Netflix, Amazon Prime, Disney+).
* Playlists de streaming adaptativo (HLS/DASH: `.m3u8`, `.mpd`) podem não gerar um arquivo único.
* Mídias carregadas apenas via **MSE + blob:** podem não estar acessíveis diretamente.

---

## 📌 Boas práticas de uso

* Use apenas para baixar **conteúdos próprios, de domínio público ou com permissão explícita**.
* Respeite direitos autorais e termos de serviço dos sites.

---

## 🔮 Ideias futuras

* Suporte a gravação por tempo customizado.
* Whitelist/blacklist de domínios.
* Preferências salvas no `chrome.storage`.
* Opção de priorizar faixas de maior qualidade.
* Porta para Firefox.

---

## 📝 Licença

Este projeto é distribuído apenas para fins educacionais. O autor **não se responsabiliza pelo uso indevido** da extensão.
