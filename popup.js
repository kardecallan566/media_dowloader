async function getCurrentTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
}


async function load() {
    const tabId = await getCurrentTabId();
    const resp = await chrome.runtime.sendMessage({ cmd: 'getMediaForTab', tabId });
    const list = document.getElementById('list');
    list.innerHTML = '';


    const items = resp?.items || [];
    if (!items.length) {
        const div = document.createElement('div');
        div.className = 'empty';
        div.textContent = 'Nada detectado ainda. Reproduza a mídia e clique em Atualizar.';
        list.appendChild(div);
        return;
    }


    for (const it of items) {
        const el = document.createElement('div');
        el.className = 'item';


        el.innerHTML = `
<div class="meta">${it.contentType || '(sem content-type)'} — ${new Date(it.time).toLocaleTimeString()}</div>
<div class="url">${it.url}</div>
<div class="row">
<a class="btn" href="${it.url}" target="_blank" rel="noopener">Abrir</a>
${/^video\//i.test(it.contentType || '') || /^audio\//i.test(it.contentType || '') ? `<a class="btn" href="${it.url}" download>Baixar</a>` : ''}
</div>
`;


        list.appendChild(el);
    }
}


document.getElementById('refresh').addEventListener('click', load);


document.getElementById('clear').addEventListener('click', async () => {
    const tabId = await getCurrentTabId();
    await chrome.runtime.sendMessage({ cmd: 'clearMediaForTab', tabId });
    load();
});


load();