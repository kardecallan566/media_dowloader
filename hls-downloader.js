/**
 * StreamDownloader - Senior Architecture
 * Robust HLS/DASH downloading with advanced parsing and error recovery.
 */

export class StreamDownloader {
    constructor(playlistUrl, type = 'HLS') {
        this.playlistUrl = playlistUrl;
        this.type = type;
        this.segments = [];
        this.isCanceled = false;
        this.concurrency = 6;
        this.maxRetries = 3;
    }

    /**
     * Resolve uma URL relativa com base na URL da playlist
     */
    resolveUrl(url, baseUrl) {
        try {
            return new URL(url, baseUrl).href;
        } catch (e) {
            return url;
        }
    }

    async fetchManifest(url = this.playlistUrl) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Falha ao carregar manifesto: ${response.status}`);
        const text = await response.text();
        const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

        if (this.type === 'HLS' || url.includes('.m3u8')) {
            // Se for um Master Playlist, precisamos buscar a playlist de mídia real
            if (text.includes('#EXT-X-STREAM-INF')) {
                return this.parseMasterHLS(text, url);
            }
            return this.parseMediaHLS(text, baseUrl);
        } else {
            return this.parseDASH(text, baseUrl);
        }
    }

    parseMasterHLS(text, masterUrl) {
        const lines = text.split('\n');
        const variants = [];
        const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#EXT-X-STREAM-INF')) {
                const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
                const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
                
                const resolution = resolutionMatch ? resolutionMatch[1] : 'Desconhecida';
                const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;
                
                let mediaUrl = lines[i + 1].trim();
                if (mediaUrl.startsWith('#')) continue; // Pula comentários extras
                
                variants.push({
                    resolution,
                    bandwidth,
                    url: this.resolveUrl(mediaUrl, baseUrl)
                });
            }
        }
        
        // Ordena por banda larga (qualidade) decrescente
        variants.sort((a, b) => b.bandwidth - a.bandwidth);
        this.variants = variants;
        return variants;
    }

    parseMediaHLS(text, baseUrl) {
        const lines = text.split('\n');
        const segments = [];
        let currentKey = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            if (line.startsWith('#EXT-X-KEY')) {
                // TODO: Implementar suporte a criptografia AES-128 se necessário
                console.warn('Criptografia detectada, suporte limitado.');
            }

            if (!line.startsWith('#')) {
                segments.push(this.resolveUrl(line, baseUrl));
            }
        }

        this.segments = segments;
        return segments;
    }

    parseDASH(text, baseUrl) {
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const segments = [];
        
        // DASH parsing sênior requer lidar com SegmentTemplate, SegmentList, etc.
        // Por brevidade, focamos na melhoria do HLS que é o caso do usuário
        const segmentUrls = xml.querySelectorAll('SegmentURL, BaseURL');
        segmentUrls.forEach(s => {
            const url = s.getAttribute('media') || s.textContent.trim();
            if (url && (url.includes('.m4s') || url.includes('.ts') || url.includes('.mp4'))) {
                segments.push(this.resolveUrl(url, baseUrl));
            }
        });

        this.segments = segments;
        return segments;
    }

    async download(onProgress) {
        if (this.segments.length === 0) throw new Error('Nenhum segmento encontrado para baixar.');

        const chunks = new Array(this.segments.length);
        let completed = 0;
        let failed = 0;

        const downloadWithRetry = async (index, retryCount = 0) => {
            if (this.isCanceled) return;
            
            try {
                const resp = await fetch(this.segments[index]);
                if (!resp.ok) throw new Error(`Status ${resp.status}`);
                chunks[index] = await resp.arrayBuffer();
                completed++;
                if (onProgress) onProgress(completed / this.segments.length);
            } catch (err) {
                if (retryCount < this.maxRetries) {
                    await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
                    return downloadWithRetry(index, retryCount + 1);
                }
                failed++;
                console.error(`Falha definitiva no segmento ${index}:`, err);
            }
        };

        // Gerenciamento de fila de download com concorrência controlada
        const queue = [...Array(this.segments.length).keys()];
        const workers = Array(this.concurrency).fill(null).map(async () => {
            while (queue.length > 0 && !this.isCanceled) {
                const index = queue.shift();
                await downloadWithRetry(index);
            }
        });

        await Promise.all(workers);

        if (this.isCanceled) return null;
        if (failed > (this.segments.length * 0.1)) {
            throw new Error(`Muitos segmentos falharam (${failed}/${this.segments.length}). Download incompleto.`);
        }

        // Concatenação de alta performance
        const validChunks = chunks.filter(c => c !== undefined);
        const totalLength = validChunks.reduce((acc, val) => acc + val.byteLength, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of validChunks) {
            result.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }
        
        return result;
    }

    cancel() {
        this.isCanceled = true;
    }
}
