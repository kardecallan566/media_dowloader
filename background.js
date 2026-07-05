// Media Finder Pro - Background Script
// Motor de detecção e persistência de mídias

async function getMediaStore() {
    const data = await chrome.storage.local.get('mediaStore');
    return data.mediaStore || {};
}

async function saveMediaStore(store) {
    await chrome.storage.local.set({ mediaStore: store });
}

async function pushMedia(tabId, item) {
    if (!tabId || tabId < 0) return;
    const store = await getMediaStore();
    const tabKey = tabId.toString();

    if (!store[tabKey]) store[tabKey] = [];
    const list = store[tabKey];

    // Evita duplicatas e agrupa URLs similares (mesma base sem query params)
    const urlBase = item.url.split('?')[0];
    if (list.some(x => x.url.split('?')[0] === urlBase)) return;

    // Metadados adicionais
    try {
        const tab = await chrome.tabs.get(tabId);
        item.tabTitle = tab.title || 'Mídia detectada';
    } catch (e) {
        item.tabTitle = item.tabTitle || 'Mídia detectada';
    }
    
    item.id = Math.random().toString(36).substr(2, 9);
    item.time = new Date().toISOString();

    list.push(item);
    if (list.length > 50) list.shift();

    await saveMediaStore(store);
    
    // Atualiza o badge
    chrome.action.setBadgeText({ text: list.length.toString(), tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6', tabId: tabId });
}

// Interceptador de rede para HLS, DASH e Vídeos Diretos
chrome.webRequest.onHeadersReceived.addListener(
    async (details) => {
        const headers = details.responseHeaders || [];
        const ctHeader = headers.find(h => h.name.toLowerCase() === 'content-type');
        const contentType = ctHeader?.value || '';
        const url = details.url;

        // Filtros para ignorar segmentos individuais e focar no arquivo completo/manifesto
        const isSegment = url.includes('.ts') || url.includes('.m4s') || url.includes('.m4v') || url.includes('.m4a') || url.includes('range=');
        if (isSegment) return;

        const isHLS = contentType.includes('mpegurl') || url.includes('.m3u8');
        const isMPD = contentType.includes('dash+xml') || url.includes('.mpd');
        const isVideo = /^(video\/)/i.test(contentType);
        const isAudio = /^(audio\/)/i.test(contentType);

        if (isHLS || isMPD || (isVideo && !isSegment) || (isAudio && !isSegment)) {
            let typeLabel = 'Video';
            if (isHLS) typeLabel = 'HLS Stream';
            else if (isMPD) typeLabel = 'DASH Stream';
            else if (isAudio) typeLabel = 'Audio';

            await pushMedia(details.tabId, {
                url,
                contentType,
                type: typeLabel
            });
        }
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
);

// Listeners de mensagens
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.cmd === 'getMediaForTab') {
        getMediaStore().then(store => {
            sendResponse({ items: store[msg.tabId.toString()] || [] });
        });
        return true;
    }

    if (msg.cmd === 'onMediaDetected') {
        pushMedia(sender.tab.id, msg);
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

// Limpa storage ao fechar aba
chrome.tabs.onRemoved.addListener(async (tabId) => {
    const store = await getMediaStore();
    delete store[tabId.toString()];
    await saveMediaStore(store);
});
