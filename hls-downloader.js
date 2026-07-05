/**
 * HLS Downloader Module
 * Manages segment fetching and concatenation
 */

export class HLSDownloader {
    constructor(playlistUrl) {
        this.playlistUrl = playlistUrl;
        this.segments = [];
        this.isCanceled = false;
    }

    async fetchManifest() {
        const response = await fetch(this.playlistUrl);
        const text = await response.text();
        return this.parseManifest(text);
    }

    parseManifest(text) {
        // Simple regex-based parser for M3U8 (fallback if library not loaded)
        const lines = text.split('\n');
        const segments = [];
        let baseUrl = this.playlistUrl.substring(0, this.playlistUrl.lastIndexOf('/') + 1);

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXTINF')) {
                let segmentUrl = lines[i + 1].trim();
                if (!segmentUrl.startsWith('http')) {
                    segmentUrl = new URL(segmentUrl, baseUrl).href;
                }
                segments.push(segmentUrl);
            }
        }
        this.segments = segments;
        return segments;
    }

    async download(onProgress) {
        const chunks = [];
        for (let i = 0; i < this.segments.length; i++) {
            if (this.isCanceled) break;
            
            const resp = await fetch(this.segments[i]);
            const buffer = await resp.arrayBuffer();
            chunks.push(buffer);
            
            if (onProgress) {
                onProgress((i + 1) / this.segments.length);
            }
        }

        if (this.isCanceled) return null;

        // Merge segments
        const totalLength = chunks.reduce((acc, val) => acc + val.byteLength, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }
        return result;
    }

    cancel() {
        this.isCanceled = true;
    }
}
