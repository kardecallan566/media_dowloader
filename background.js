// Media Finder Pro - Background Script
// Gestão de mídias detectadas com persistência e detecção avançada para YouTube

async function getMediaStore() {
    const data = await chrome.storage.local.get('mediaStore');
    return data.mediaStore || {};
}

async function saveMediaStore(store) {
    await chrome.storage.local.set({ mediaStore: store });
}

async function addToHistory(item) {
    const data = await chrome.storage.local.get('history');
    const history = data.history || [];
    history.unshift({ ...item, timestamp: Date.now() });
    if (history.length > 100) history.pop();
    await chrome.storage.local.set({ history });
}

async function pushMedia(tabId, item) {
    if (!tabId || tabId < 0) return;
    const store = await getMediaStore();
    const tabKey = tabId.toString();

    if (!store[tabKey]) store[tabKey] = [];
    const list = store[tabKey];

    // Para YouTube, evitamos duplicar o mesmo vídeo (baseado no ID ou assinatura da URL)
    const isYouTube = item.url.includes('googlevideo.com');
    if (isYouTube) {
        // Tenta encontrar uma URL similar (mesmo id de vídeo no YouTube)
        const match = item.url.match(/[&?]id=([^&]+)/);
        const vidId = match ? match[1] : null;
        if (vidId && list.some(x => x.url.includes(`id=${vidId}`))) return;
    }

    if (!list.some(x => x.url === item.url)) {
        try {
            const tab = await chrome.tabs.get(tabId);
            item.tabTitle = tab.title || 'Mídia detectada';
        } catch (e) {
            item.tabTitle = 'Mídia detectada';
        }

        list.push(item);
        if (list.length > 50) list.shift();

        await saveMediaStore(store);
        chrome.action.setBadgeText({ text: list.length.toString(), tabId: tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId: tabId });
    }
}

// Intercepta requisições de rede
chrome.webRequest.onHeadersReceived.addListener(
    async (details) => {
        try {
            const headers = details.responseHeaders || [];
            const ctHeader = headers.find(h => h.name.toLowerCase() === 'content-type');
            const clHeader = headers.find(h => h.name.toLowerCase() === 'content-length');

            const contentType = ctHeader?.value || '';
            const contentLength = clHeader?.value ? parseInt(clHeader.value) : 0;
            const url = details.url;

            // Detecção para YouTube (Google Video)
            const isYouTubeMedia = url.includes('googlevideo.com/videoplayback');
            const isVideo = /^(video\/)/i.test(contentType);
            const isAudio = /^(audio\/)/i.test(contentType);
            const isHLS = contentType.includes('mpegurl') || url.includes('.m3u8');
            const isMPD = contentType.includes('dash+xml') || url.includes('.mpd');
            const isPlaylist = isHLS || isMPD;

            if (isYouTubeMedia || isVideo || isAudio || isPlaylist) {
                let typeLabel = 'Video';
                if (isAudio && !isYouTubeMedia) typeLabel = 'Audio';
                if (isHLS) typeLabel = 'HLS Stream';
                if (isMPD) typeLabel = 'DASH Stream';

                // No YouTube, o Content-Type pode vir como 'video/webm' ou 'application/x-protobuf'
                if (isYouTubeMedia) {
                    typeLabel = 'YouTube Stream';
                    // Filtra apenas streams que pareçam ser de vídeo (pelo parâmetro mime na URL)
                    if (url.includes('mime=audio')) typeLabel = 'YouTube Audio';
                }

                await pushMedia(details.tabId, {
                    url,
                    contentType,
                    size: contentLength,
                    type: typeLabel,
                    time: new Date().toISOString()
                });
            }
        } catch (e) {
            // Silencioso
        }
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
);

chrome.tabs.onRemoved.addListener(async (tabId) => {
    const store = await getMediaStore();
    delete store[tabId.toString()];
    await saveMediaStore(store);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.cmd === 'getMediaForTab') {
        getMediaStore().then(store => {
            const list = store[msg.tabId.toString()] || [];
            sendResponse({ items: list });
        });
        return true;
    }

    if (msg.cmd === 'clearMediaForTab') {
        getMediaStore().then(async (store) => {
            delete store[msg.tabId.toString()];
            await saveMediaStore(store);
            chrome.action.setBadgeText({ text: '', tabId: msg.tabId });
            sendResponse({ ok: true });
        });
        return true;
    }
});