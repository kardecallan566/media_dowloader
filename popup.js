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

    // Fallback para título
    const title = item.tabTitle || 'Mídia detectada';
    const tagClass = getTagClass(item.type);
    const sizeStr = formatSize(item.size);
    const timeStr = new Date(item.time).toLocaleTimeString();

    card.innerHTML = `
        <div class="media-info">
            <div class="media-title" title="${title}">${title}</div>
            <div class="media-meta">
                <span class="tag ${tagClass}">${item.type || 'Media'}</span>
                <span>${sizeStr}</span>
                <span>${timeStr}</span>
            </div>
            <div class="media-url" title="${item.url}">${item.url}</div>
        </div>
        <div class="actions">
            <a href="${item.url}" target="_blank" rel="noopener" class="btn-action">Abrir</a>
            ${item.contentType?.includes('application/vnd.apple.mpegurl') ?
            `<button class="btn-action btn-primary copy-btn" data-url="${item.url}">Copiar Link HLS</button>` :
            `<a href="${item.url}" download class="btn-action btn-primary">Baixar</a>`
        }
        </div>
    `;

    // Handler para cópia (HLS)
    const copyBtn = card.querySelector('.copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(item.url).then(() => {
                copyBtn.textContent = 'Copiado!';
                setTimeout(() => copyBtn.textContent = 'Copiar Link HLS', 2000);
            });
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
        listElement.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 48px; margin-bottom: 20px;">🕵️‍♂️</div>
                <p>Nenhuma mídia detectada nesta página.</p>
                <p style="font-size: 11px; margin-top: 8px;">Dica: Play no vídeo para detectar. ▶️</p>
            </div>
        `;
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