/**
 * HLS Downloader Pro
 * Suporte a downloads paralelos e tratamento de segmentos TS
 */

export class StreamDownloader {
    constructor(playlistUrl, type = 'HLS') {
        this.playlistUrl = playlistUrl;
        this.type = type;
        this.segments = [];
        this.isCanceled = false;
        this.concurrency = 5;
    }

    async fetchManifest() {
        const response = await fetch(this.playlistUrl);
        const text = await response.text();
        if (this.type === 'HLS' || this.playlistUrl.includes('.m3u8')) {
            if (text.includes('#EXT-X-STREAM-INF')) {
                return this.parseMasterHLS(text);
            }
            return this.parseHLS(text);
        } else {
            return this.parseDASH(text);
        }
    }

    parseMasterHLS(text) {
        const lines = text.split('\n');
        const variants = [];
        const baseUrl = this.playlistUrl.substring(0, this.playlistUrl.lastIndexOf('/') + 1);
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                const resolutionMatch = lines[i].match(/RESOLUTION=(\d+x\d+)/);
                const resolution = resolutionMatch ? resolutionMatch[1] : 'Desconhecida';
                let url = lines[i+1].trim();
                url = url.startsWith('http') ? url : new URL(url, baseUrl).href;
                variants.push({ resolution, url });
            }
        }
        this.variants = variants;
        return variants;
    }

    parseHLS(text) {
        const lines = text.split('\n');
        const segments = [];
        const baseUrl = this.playlistUrl.substring(0, this.playlistUrl.lastIndexOf('/') + 1);
        for (let line of lines) {
            line = line.trim();
            if (line && !line.startsWith('#')) {
                segments.push(line.startsWith('http') ? line : new URL(line, baseUrl).href);
            }
        }
        this.segments = segments;
        return segments;
    }

    parseDASH(text) {
        // Parser simplificado para MPD
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const baseUrl = this.playlistUrl.substring(0, this.playlistUrl.lastIndexOf('/') + 1);
        const segments = [];
        
        // Tenta encontrar SegmentURL ou BaseURL
        const segmentUrls = xml.querySelectorAll('SegmentURL');
        segmentUrls.forEach(s => {
            const media = s.getAttribute('media');
            if (media) segments.push(media.startsWith('http') ? media : new URL(media, baseUrl).href);
        });

        if (segments.length === 0) {
            const baseUrls = xml.querySelectorAll('BaseURL');
            baseUrls.forEach(b => {
                const url = b.textContent.trim();
                if (url.includes('.m4s') || url.includes('.ts')) {
                    segments.push(url.startsWith('http') ? url : new URL(url, baseUrl).href);
                }
            });
        }

        this.segments = segments;
        return segments;
    }

    async download(onProgress) {
        const chunks = new Array(this.segments.length);
        let completed = 0;

        const downloadSegment = async (index) => {
            if (this.isCanceled) return;
            try {
                const resp = await fetch(this.segments[index]);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                chunks[index] = await resp.arrayBuffer();
                completed++;
                if (onProgress) onProgress(completed / this.segments.length);
            } catch (err) {
                console.error(`Falha no segmento ${index}:`, err);
                // Tenta novamente uma vez
                if (!this.isCanceled) {
                    const resp = await fetch(this.segments[index]);
                    chunks[index] = await resp.arrayBuffer();
                    completed++;
                    if (onProgress) onProgress(completed / this.segments.length);
                }
            }
        };

        // Execução em pools para não travar o navegador
        for (let i = 0; i < this.segments.length; i += this.concurrency) {
            if (this.isCanceled) break;
            const pool = [];
            for (let j = 0; j < this.concurrency && (i + j) < this.segments.length; j++) {
                pool.push(downloadSegment(i + j));
            }
            await Promise.all(pool);
        }

        if (this.isCanceled) return null;

        // Concatenação eficiente
        const totalLength = chunks.reduce((acc, val) => acc + (val ? val.byteLength : 0), 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            if (chunk) {
                result.set(new Uint8Array(chunk), offset);
                offset += chunk.byteLength;
            }
        }
        return result;
    }

    cancel() {
        this.isCanceled = true;
    }
}
