// Media Finder Pro - Content Script (Versão Ultra Otimizada)
// Suporte a YouTube Shorts e Vídeos com Escolha de Formato

(function () {
    const OVERLAY_ID = 'mf-media-overlay-container';

    // Estilos aprimorados com menu de opções
    const style = document.createElement('style');
    style.textContent = `
        #${OVERLAY_ID} {
            position: absolute;
            z-index: 2147483647;
            display: none;
            flex-direction: column;
            gap: 5px;
            pointer-events: auto;
            font-family: 'Inter', sans-serif;
        }
        .mf-main-btn {
            background: linear-gradient(135deg, #ff0000, #ff5f5f);
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(255, 0, 0, 0.4);
            border: 2px solid white;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .mf-options-menu {
            background: rgba(15, 23, 42, 0.95);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 8px;
            display: none;
            flex-direction: column;
            gap: 4px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.5);
        }
        .mf-option-item {
            padding: 8px 12px;
            border-radius: 8px;
            color: white;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background 0.2s;
            border: none;
            background: transparent;
            text-align: left;
            width: 100%;
        }
        .mf-option-item:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        .mf-option-item emoji { font-size: 14px; }

        .mf-recording-state {
            background: #22c55e !important;
            animation: mf-pulse 1.5s infinite;
        }

        @keyframes mf-pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
        }
    `;
    document.documentElement.appendChild(style);

    const container = document.createElement('div');
    container.id = OVERLAY_ID;

    const mainBtn = document.createElement('button');
    mainBtn.className = 'mf-main-btn';
    mainBtn.innerHTML = '📥 BAIXAR MÍDIA';

    const menu = document.createElement('div');
    menu.className = 'mf-options-menu';

    const options = [
        { id: 'full', label: 'Vídeo + Áudio', emoji: '🎬', ext: 'mp4' },
        { id: 'video', label: 'Somente Vídeo', emoji: '📹', ext: 'mp4' },
        { id: 'audio', label: 'Somente Áudio', emoji: '🎵', ext: 'm4a' }
    ];

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'mf-option-item';
        btn.innerHTML = `<span>${opt.emoji}</span> ${opt.label}`;
        btn.onclick = (e) => {
            e.stopPropagation();
            startRecordingProcess(opt.id, opt.ext);
            menu.style.display = 'none';
        };
        menu.appendChild(btn);
    });

    container.appendChild(mainBtn);
    container.appendChild(menu);
    document.body.appendChild(container);

    let activeVideo = null;
    let currentRecorder = null;
    let isRecording = false;
    let hideTimeout = null;

    function updatePosition(video) {
        if (!video) return;
        const rect = video.getBoundingClientRect();
        container.style.display = 'flex';
        container.style.top = (window.scrollY + rect.top + 15) + 'px';
        container.style.left = (window.scrollX + rect.left + 15) + 'px';
    }

    mainBtn.onclick = (e) => {
        e.stopPropagation();
        if (isRecording) {
            stopRecording();
        } else {
            menu.style.display = (menu.style.display === 'flex') ? 'none' : 'flex';
        }
    };

    document.addEventListener('mouseover', (e) => {
        const video = e.target.tagName === 'VIDEO' ? e.target : e.target.closest('.html5-video-player, #shorts-container')?.querySelector('video');
        if (video) {
            activeVideo = video;
            updatePosition(activeVideo);
            if (hideTimeout) clearTimeout(hideTimeout);
        }
    });

    document.addEventListener('mouseleave', (e) => {
        if (!isRecording && !container.contains(e.relatedTarget)) {
            hideTimeout = setTimeout(() => {
                container.style.display = 'none';
                menu.style.display = 'none';
            }, 3000);
        }
    });

    async function startRecordingProcess(mode, ext) {
        if (!activeVideo) return;

        try {
            // Configurações de otimização para evitar travamentos
            // Reduzimos a carga inicial não solicitando dados em intervalos muito curtos
            const stream = activeVideo.captureStream ? activeVideo.captureStream() : activeVideo.mozCaptureStream?.();
            if (!stream) throw new Error('Captura bloqueada pelo navegador.');

            // Filtra tracks baseado na escolha do usuário
            const tracks = [];
            if (mode === 'full' || mode === 'video') {
                tracks.push(...stream.getVideoTracks());
            }
            if (mode === 'full' || mode === 'audio') {
                tracks.push(...stream.getAudioTracks());
            }

            const filteredStream = new MediaStream(tracks);

            // Otimização de Bitrate: 2.5Mbps para vídeo e 128kbps para áudio (balanço entre qualidade e performance)
            const options = {
                mimeType: mode === 'audio' ? 'audio/webm;codecs=opus' : 'video/webm;codecs=vp8,opus',
                videoBitsPerSecond: 2500000,
                audioBitsPerSecond: 128000
            };

            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                delete options.mimeType; // Fallback se não suportado
            }

            const chunks = [];
            currentRecorder = new MediaRecorder(filteredStream, options);
            isRecording = true;

            mainBtn.innerHTML = '🔴 GRAVANDO... (CLIQUE PARA SALVAR)';
            mainBtn.classList.add('mf-recording-state');

            currentRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) chunks.push(e.data);
            };

            currentRecorder.onstop = () => {
                const blobType = mode === 'audio' ? 'audio/mp4' : 'video/mp4';
                const blob = new Blob(chunks, { type: blobType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;

                const cleanTitle = (document.title || 'media_finder').replace(/[/\\?%*:|"<>]/g, '-');
                a.download = `${cleanTitle}_${mode}.${ext}`;

                document.body.appendChild(a);
                a.click();
                a.remove();

                resetUI();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            };

            // IMPORTANTE: Removemos o timeslice (1000) para processamento sob demanda, 
            // o que reduz drasticamente o lag no vídeo enquanto ele toca.
            currentRecorder.start();

        } catch (err) {
            alert('Erro: ' + err.message);
            resetUI();
        }
    }

    function stopRecording() {
        if (currentRecorder && currentRecorder.state === 'recording') {
            currentRecorder.stop();
        }
    }

    function resetUI() {
        isRecording = false;
        mainBtn.innerHTML = '📥 BAIXAR MÍDIA';
        mainBtn.classList.remove('mf-recording-state');
        menu.style.display = 'none';
    }

    // Scroll sync
    window.addEventListener('scroll', () => {
        if (activeVideo && !isRecording) updatePosition(activeVideo);
    }, { passive: true });

})();