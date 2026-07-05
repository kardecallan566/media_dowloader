// Media Finder Pro - Popup Logic
// Interação com o store do background script

async function getCurrentTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
}

function formatSize(bytes) {
    if (!bytes || bytes === 0) return 'Tamanho desconhecido';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
}

function getTagClass(type) {
    const t = type?.toLowerCase() || '';
    if (t.includes('video')) return 'video';
    if (t.includes('audio')) return 'audio';
    if (t.includes('stream')) return 'stream';
    return '';
}

function createMediaCard(item) {
    const card = document.createElement('div');
    card.className = 'media-card';

    const title = item.tabTitle || 'Mídia detectada';
    const tagClass = getTagClass(item.type);
    const sizeStr = formatSize(item.size);
    const timeStr = new Date(item.time).toLocaleTimeString();
    const isStream = item.type.includes('Stream');

    card.innerHTML = `
        <div class="media-info">
            <div class="media-title" title="${title}">${title}</div>
            <div class="media-meta">
                <span class="tag ${tagClass}">${item.type || 'Media'}</span>
                <span>${sizeStr}</span>
                <span>${timeStr}</span>
            </div>
            <div class="progress-container" style="display:none; margin-top:8px;">
                <div class="progress-bar" style="width:0%; height:4px; background:var(--primary); border-radius:2px; transition: width 0.3s;"></div>
                <div class="progress-text" style="font-size:10px; color:var(--text-dim); margin-top:4px;">Iniciando download...</div>
            </div>
            <div class="media-url" title="${item.url}">${item.url}</div>
        </div>
        <div class="actions">
            <a href="${item.url}" target="_blank" rel="noopener" class="btn-action">Link</a>
            ${isStream ? 
                `<button class="btn-action btn-primary download-stream-btn" data-url="${item.url}" data-type="${item.type}">Baixar Stream</button>` :
                `<a href="${item.url}" download="${title}.mp4" class="btn-action btn-primary">Baixar</a>`
            }
        </div>
    `;

    const dlBtn = card.querySelector('.download-stream-btn');
    if (dlBtn) {
        dlBtn.addEventListener('click', async () => {
            const url = dlBtn.dataset.url;
            const type = dlBtn.dataset.type;
            const progressContainer = card.querySelector('.progress-container');
            const progressBar = card.querySelector('.progress-bar');
            const progressText = card.querySelector('.progress-text');

            dlBtn.disabled = true;
            dlBtn.textContent = 'Processando...';
            progressContainer.style.display = 'block';

            try {
                if (type.includes('HLS')) {
                    const { HLSDownloader } = await import('./hls-downloader.js');
                    const downloader = new HLSDownloader(url);
                    await downloader.fetchManifest();
                    
                    const data = await downloader.download((p) => {
                        const pct = Math.round(p * 100);
                        progressBar.style.width = `${pct}%`;
                        progressText.textContent = `Baixando segmentos: ${pct}%`;
                    });

                    if (data) {
                        const blob = new Blob([data], { type: 'video/mp4' });
                        const blobUrl = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = `${title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
                        progressText.textContent = 'Download concluído!';
                    }
                } else {
                    // Para DASH ou outros, fallback de cópia por enquanto ou implementação futura
                    navigator.clipboard.writeText(url);
                    progressText.textContent = 'Link copiado (Suporte DASH em breve)';
                }
            } catch (err) {
                progressText.textContent = 'Erro no download: ' + err.message;
                console.error(err);
            } finally {
                dlBtn.disabled = false;
                dlBtn.textContent = 'Baixar Stream';
            }
        });
    }

    return card;
}

async function render() {
    const listElement = document.getElementById('list');
    const tabId = await getCurrentTabId();

    if (!tabId) return;

    // Solicita itens ao background (via storage no final das contas)
    const resp = await chrome.runtime.sendMessage({ cmd: 'getMediaForTab', tabId });
    const items = resp?.items || [];

    listElement.innerHTML = '';

    if (items.length === 0) {
        const historyData = await chrome.storage.local.get('history');
        const history = historyData.history || [];
        
        if (history.length > 0) {
            listElement.innerHTML = '<div style="font-size:12px; color:var(--text-dim); margin-bottom:10px; font-weight:600;">HISTÓRICO RECENTE</div>';
            history.forEach(item => listElement.appendChild(createMediaCard(item)));
        } else {
            listElement.innerHTML = `
                <div class="empty-state">
                    <div style="font-size: 48px; margin-bottom: 20px;">🕵️‍♂️</div>
                    <p>Nenhuma mídia detectada nesta página.</p>
                    <p style="font-size: 11px; margin-top: 8px;">Dica: Play no vídeo para detectar. ▶️</p>
                </div>
            `;
        }
        return;
    }

    // Inverte para mostrar os mais recentes primeiro
    [...items].reverse().forEach(item => {
        listElement.appendChild(createMediaCard(item));
    });
}

document.getElementById('refresh').addEventListener('click', render);

document.getElementById('clear').addEventListener('click', async () => {
    const tabId = await getCurrentTabId();
    if (tabId) {
        await chrome.runtime.sendMessage({ cmd: 'clearMediaForTab', tabId });
        render();
    }
});

// Inicialização
document.addEventListener('DOMContentLoaded', render);