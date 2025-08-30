(function () {
    const BTN_CLASS = 'mf-download-btn';


    const style = document.createElement('style');
    style.textContent = `
.${BTN_CLASS} {
position: absolute; z-index: 2147483647; right: 12px; bottom: 12px;
padding: 8px 10px; border-radius: 12px; background: rgba(0,0,0,.7);
color: #fff; font: 500 12px/1 sans-serif; cursor: pointer; border: none;
}
.mf-video-wrap { position: relative !important; display: inline-block; }
`;
    document.documentElement.appendChild(style);


    const seen = new WeakSet();


    function addButton(v) {
        if (seen.has(v)) return;
        seen.add(v);


        // Garante wrapper posicionado
        if (!v.parentElement.classList.contains('mf-video-wrap')) {
            const wrap = document.createElement('span');
            wrap.className = 'mf-video-wrap';
            v.parentElement.insertBefore(wrap, v);
            wrap.appendChild(v);
        }


        const btn = document.createElement('button');
        btn.className = BTN_CLASS;
        btn.textContent = 'Baixar/Gravar';
        btn.title = 'Baixar src direto (se permitido) ou gravar o que estiver reproduzindo.';


        btn.addEventListener('click', async () => {
            const src = v.currentSrc || v.src;
            if (src && !src.startsWith('blob:')) {
                // Tenta baixar diretamente via link (respeita CORS do servidor)
                const a = document.createElement('a');
                a.href = src;
                a.download = '';
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
            } else {
                // Fallback: gravar via MediaRecorder (não funciona com DRM)
                try {
                    const stream = v.captureStream ? v.captureStream() : v.mozCaptureStream?.();
                    if (!stream) throw new Error('captureStream indisponível');


                    const chunks = [];
                    const mr = new MediaRecorder(stream, { mimeType: 'video/webm' });
                    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
                    mr.onstop = () => {
                        const blob = new Blob(chunks, { type: 'video/webm' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = 'recording.webm';
                        document.body.appendChild(a); a.click(); a.remove();
                        setTimeout(() => URL.revokeObjectURL(url), 5000);
                    };
                    // Grava 10s como demo; ajuste conforme necessário
                    mr.start();
                    setTimeout(() => mr.state !== 'inactive' && mr.stop(), 10000);
                } catch (err) {
                    alert('Não foi possível baixar/gravar esta mídia (possível DRM ou restrições do site).');
                }
            }
        });


        v.parentElement.appendChild(btn);
    }


    function scan() {
        document.querySelectorAll('video').forEach(addButton);
    }


    const mo = new MutationObserver(scan);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    scan();
})();