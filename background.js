// Armazena mídias detectadas por aba
const mediaStore = new Map(); // tabId -> [{ url, type, contentType, time }]


function pushMedia(tabId, item) {
    if (!mediaStore.has(tabId)) mediaStore.set(tabId, []);
    const list = mediaStore.get(tabId);
    // Evita duplicatas simples
    if (!list.some(x => x.url === item.url)) list.push(item);
}


// Detecta conteúdo de mídia pelos headers de resposta
chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
        try {
            const ctHeader = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type');
            const contentType = ctHeader?.value || '';
            const url = details.url;
            const type = details.type; // 'media', 'xmlhttprequest', etc.


            // Considera tipos diretos de vídeo/áudio
            const isDirectMedia = /^(video|audio)\//i.test(contentType);
            // Observa playlists (sem baixar por aqui)
            const isPlaylist = /(application\/vnd\.apple\.mpegurl|application\/x-mpegurl|application\/dash\+xml)/i.test(contentType);


            if (isDirectMedia || isPlaylist) {
                pushMedia(details.tabId, {
                    url,
                    type,
                    contentType,
                    time: new Date().toISOString()
                });
            }
        } catch (e) {
            // silencioso
        }
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders", "extraHeaders"]
);


// Limpa store quando a aba fecha
chrome.tabs.onRemoved.addListener((tabId) => {
    mediaStore.delete(tabId);
});


// Comunicação com popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.cmd === 'getMediaForTab') {
        const list = mediaStore.get(msg.tabId) || [];
        sendResponse({ items: list });
        return true;
    }
    if (msg?.cmd === 'clearMediaForTab') {
        mediaStore.set(msg.tabId, []);
        sendResponse({ ok: true });
        return true;
    }
});