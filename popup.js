// Media Finder Pro - Popup Controller
import { StreamDownloader } from './hls-downloader.js';

async function getCurrentTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
}

function formatSize(bytes) {
    if (!bytes || bytes === 0) return 'Tamanho dinâmico';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
}

function createMediaCard(item) {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.id = `media-${item.id}`;

    const title = item.tabTitle || 'Mídia detectada';
    const isStream = item.type.includes('Stream');
    const timeStr = new Date(item.time).toLocaleTimeString();

    card.innerHTML = `
        <div class="media-info">
            <div class="media-title" title="${title}">${title}</div>
            <div class="media-meta">
                <span class="tag ${item.type.toLowerCase().split(' ')[0]}">${item.type}</span>
                <span>${timeStr}</span>
            </div>
            <div class="quality-selector" style="margin-top:8px; display:${isStream ? 'block' : 'none'}">
                <select class="quality-select" style="width:100%; background:#1e293b; color:white; border:1px solid #334155; padding:4px; border-radius:4px; font-size:11px;">
                    <option value="auto">Melhor Qualidade (Auto)</option>
                </select>
            </div>
            <div class="progress-container" style="display:none; margin-top:10px;">
                <div class="progress-bg" style="width:100%; height:6px; background:#1e293b; border-radius:3px; overflow:hidden;">
                    <div class="progress-fill" style="width:0%; height:100%; background:linear-gradient(90deg, #8b5cf6, #06b6d4); transition: width 0.3s;"></div>
                </div>
                <div class="progress-text" style="font-size:10px; color:#94a3b8; margin-top:5px; display:flex; justify-content:space-between;">
                    <span>Preparando...</span>
                    <span class="pct">0%</span>
                </div>
            </div>
            <div class="media-url" title="${item.url}">${item.url}</div>
        </div>
        <div class="actions">
            <button class="btn-action btn-primary dl-btn" data-url="${item.url}" data-type="${item.type}">
                ${isStream ? 'Baixar Agora' : 'Download Direto'}
            </button>
        </div>
    `;

    const dlBtn = card.querySelector('.dl-btn');
    const qualitySelect = card.querySelector('.quality-select');

    // Tenta carregar qualidades se for stream
    if (isStream) {
        (async () => {
            try {
                const downloader = new StreamDownloader(item.url, item.type.includes('HLS') ? 'HLS' : 'DASH');
                const variants = await downloader.fetchManifest();
                if (Array.isArray(variants) && variants[0]?.resolution) {
                    // Ordena por resolução (maior primeiro)
                    variants.sort((a, b) => {
                        const resA = parseInt(a.resolution.split('x')[1] || 0);
                        const resB = parseInt(b.resolution.split('x')[1] || 0);
                        return resB - resA;
                    });

                    qualitySelect.innerHTML = '';
                    variants.forEach(v => {
                        const opt = document.createElement('option');
                        opt.value = v.url;
                        opt.textContent = `${v.resolution} (HD)`;
                        qualitySelect.appendChild(opt);
                    });
                }
            } catch (e) { console.error('Erro ao carregar variantes', e); }
        })();
    }

    dlBtn.onclick = async () => {
        const selectedUrl = qualitySelect.value === 'auto' ? item.url : qualitySelect.value;
        const progressContainer = card.querySelector('.progress-container');
        const progressFill = card.querySelector('.progress-fill');
        const progressText = card.querySelector('.progress-text span');
        const progressPct = card.querySelector('.pct');

        dlBtn.disabled = true;
        dlBtn.style.opacity = '0.5';
        dlBtn.textContent = 'Processando...';
        progressContainer.style.display = 'block';

        try {
            if (isStream) {
                const downloader = new StreamDownloader(selectedUrl, item.type.includes('HLS') ? 'HLS' : 'DASH');
                
                progressText.textContent = 'Analisando playlist...';
                await downloader.fetchManifest();
                
                const totalSegments = downloader.segments.length;
                progressText.textContent = `Iniciando download (${totalSegments} segmentos)...`;

                const data = await downloader.download((p) => {
                    const pct = Math.round(p * 100);
                    progressFill.style.width = `${pct}%`;
                    progressPct.textContent = `${pct}%`;
                    const current = Math.round(p * totalSegments);
                    progressText.textContent = `Baixando: ${current}/${totalSegments} segmentos`;
                });

                if (data) {
                    progressText.textContent = 'Finalizando arquivo...';
                    const blob = new Blob([data], { type: 'video/mp4' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
                    a.click();
                    progressText.textContent = 'Download concluído!';
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                }
            } else {
                // Download direto via API do Chrome para evitar problemas de CORS no Blob
                chrome.downloads.download({
                    url: item.url,
                    filename: `${title.replace(/[^a-z0-9]/gi, '_')}.mp4`,
                    saveAs: false
                });
                progressFill.style.width = '100%';
                progressPct.textContent = '100%';
                progressText.textContent = 'Enviado para o navegador';
            }
        } catch (err) {
            progressText.textContent = 'Erro!';
            console.error(err);
        } finally {
            dlBtn.disabled = false;
            dlBtn.style.opacity = '1';
            dlBtn.textContent = isStream ? 'Baixar Novamente' : 'Baixar Direto';
        }
    };

    return card;
}

async function render() {
    const listElement = document.getElementById('list');
    const tabId = await getCurrentTabId();
    if (!tabId) return;

    const resp = await chrome.runtime.sendMessage({ cmd: 'getMediaForTab', tabId });
    const items = resp?.items || [];

    listElement.innerHTML = '';

    if (items.length === 0) {
        listElement.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 40px;">🔍</div>
                <p>Aguardando mídias...</p>
                <p style="font-size: 11px; color: #64748b;">Inicie a reprodução do vídeo para detectar.</p>
            </div>
        `;
        return;
    }

    [...items].reverse().forEach(item => {
        listElement.appendChild(createMediaCard(item));
    });
}

document.getElementById('refresh').onclick = render;
document.getElementById('clear').onclick = async () => {
    const tabId = await getCurrentTabId();
    await chrome.runtime.sendMessage({ cmd: 'clearMediaForTab', tabId });
    render();
};

document.addEventListener('DOMContentLoaded', render);
