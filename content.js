// Media Finder Pro - Content Script
// Focado em detecção de elementos de vídeo e comunicação com o popup

(function () {
    // Remove qualquer overlay antigo se existir
    const oldOverlay = document.getElementById('mf-media-overlay-container');
    if (oldOverlay) oldOverlay.remove();

    // Estilos para indicadores visuais discretos
    const style = document.createElement('style');
    style.textContent = `
        .mf-detected-badge {
            position: absolute;
            z-index: 2147483647;
            background: #8b5cf6;
            color: white;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 10px;
            font-weight: bold;
            pointer-events: none;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            animation: mf-fade-in 0.3s ease;
        }
        @keyframes mf-fade-in { from { opacity: 0; } to { opacity: 1; } }
    `;
    document.documentElement.appendChild(style);

    function detectVideos() {
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            if (video.src && !video.dataset.mfDetected) {
                video.dataset.mfDetected = 'true';
                // Notifica o background sobre o vídeo direto encontrado
                chrome.runtime.sendMessage({
                    cmd: 'onMediaDetected',
                    url: video.src,
                    type: 'Video (Direct)',
                    tabTitle: document.title
                });
            }
        });
    }

    // Observa mudanças no DOM para novos vídeos (como em SPAs ou YouTube)
    const observer = new MutationObserver(() => detectVideos());
    observer.observe(document.body, { childList: true, subtree: true });

    // Detecção inicial
    detectVideos();
})();
