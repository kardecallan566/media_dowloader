// HLS playlist parser/downloader. No transcoding, DRM bypass or fake MP4 conversion.
import { signedExpiry } from './download-routing.js';
export function absoluteUrl(value, base) {
  const url = new URL(value, base);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('URL de mídia inválida.');
  return url.href;
}

export function attributes(line) {
  const attrs = {};
  const expression = /([A-Z0-9-]+)=("(?:[^"]*)"|[^,]*)/g;
  let match;
  while ((match = expression.exec(line)) !== null) {
    attrs[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return attrs;
}

export function parseMaster(text, url) {
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const audioGroups = new Map();
  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const a = attributes(line);
    if (a.TYPE === 'AUDIO' && a['GROUP-ID'] && a.URI) {
      audioGroups.set(a['GROUP-ID'], absoluteUrl(a.URI, url));
    }
  }
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const a = attributes(lines[i]);
    const next = lines.slice(i + 1).find(candidate => candidate && !candidate.startsWith('#'));
    if (!next) continue;
    variants.push({
      url: absoluteUrl(next, url),
      resolution: a.RESOLUTION || 'Automática',
      bandwidth: Number(a['AVERAGE-BANDWIDTH'] || a.BANDWIDTH || 0),
      separateAudio: audioGroups.get(a.AUDIO) || null
    });
  }
  return variants.sort((a, b) => b.bandwidth - a.bandwidth);
}

function rangeSpec(spec, priorEnd) {
  if (!spec) return { range: null, nextOffset: priorEnd };
  const [lengthText, offsetText] = spec.split('@');
  const length = Number(lengthText);
  const offset = offsetText === undefined ? priorEnd : Number(offsetText);
  if (!Number.isSafeInteger(length) || length < 1 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('BYTERANGE inválido.');
  }
  return { range: [offset, offset + length - 1], nextOffset: offset + length };
}

export function parseMedia(text, url) {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('O servidor não retornou uma playlist HLS.');
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const isVod = lines.some(line => line === '#EXT-X-ENDLIST');
  const segments = [];
  let map = null;
  let pendingRange = null;
  let segmentOffset = 0;
  let lastSegmentUrl = '';
  let sawDiscontinuity = false;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-KEY:')) {
      const key = attributes(line);
      if (key.METHOD && key.METHOD !== 'NONE') throw new Error('Esta playlist usa criptografia HLS não suportada. Conteúdo protegido não é baixado.');
    } else if (line.startsWith('#EXT-X-SESSION-KEY:')) {
      const key = attributes(line);
      if (key.METHOD && key.METHOD !== 'NONE') throw new Error('A playlist contém chave de criptografia não suportada.');
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const a = attributes(line);
      if (!a.URI) throw new Error('EXT-X-MAP sem URI.');
      const spec = rangeSpec(a.BYTERANGE, 0);
      map = { url: absoluteUrl(a.URI, url), range: spec.range };
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = line.slice('#EXT-X-BYTERANGE:'.length);
    } else if (line === '#EXT-X-DISCONTINUITY') {
      sawDiscontinuity = true;
    } else if (line && !line.startsWith('#')) {
      const segmentUrl = absoluteUrl(line, url);
      if (segmentUrl !== lastSegmentUrl) segmentOffset = 0;
      const ranged = rangeSpec(pendingRange, segmentOffset);
      segments.push({ url: segmentUrl, range: ranged.range, map });
      segmentOffset = ranged.nextOffset;
      lastSegmentUrl = segmentUrl;
      pendingRange = null;
    }
  }
  if (!segments.length) throw new Error('A playlist não contém segmentos de vídeo.');
  if (!isVod) throw new Error('Este stream é ao vivo ou ainda não tem fim definido. Somente vídeos completos (VOD) são suportados.');
  if (sawDiscontinuity) throw new Error('Playlist com descontinuidade de codecs/timestamps requer remux; não será gerado arquivo inválido.');
  const last = segments[0].url.split('?')[0].toLowerCase();
  const isMp4 = Boolean(map);
  if (!isMp4 && !(/\.ts$/i.test(last) || /\.aac$/i.test(last) || /\.mp3$/i.test(last))) {
    throw new Error('Formato de segmento HLS desconhecido. Download bloqueado para evitar arquivo corrompido.');
  }
  if (segments.some(s => Boolean(s.map) !== isMp4)) throw new Error('Playlist alterna segmentos incompatíveis.');
  const ext = isMp4 ? 'mp4' : (/\.aac$/i.test(last) ? 'aac' : /\.mp3$/i.test(last) ? 'mp3' : 'ts');
  return { segments, extension: ext, isVod: true };
}

export function playlistExpiry(url, now=Date.now()) {
 const expiry=signedExpiry(url,now);
 return expiry ? (expiry.expired?'expired':'valid') : null;
}

export class StreamDownloader {
  constructor(url, { concurrency = 4, maxBytes = 450 * 1024 * 1024,
    fetcher=(...args)=>globalThis.fetch(...args), requestTimeoutMs=25000 } = {}) {
    this.url = absoluteUrl(url, url);
    this.concurrency = concurrency;
    this.maxBytes = maxBytes;
    this.controller = new AbortController();
    this.fetcher=fetcher;
    this.requestTimeoutMs=requestTimeoutMs;
    this.parsed = null;
    this.variants = [];
  }

  async timedRequest(url, options, readBody) {
    if(this.controller.signal.aborted)throw new Error('Download cancelado.');
    const local=new AbortController();
    const abort=()=>local.abort();
    this.controller.signal.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>local.abort(),this.requestTimeoutMs);
    try {
      // A bare browser fetch cannot be invoked with the StreamDownloader instance as `this`.
      // Calling a local function also keeps dependency-injected fetch mocks independent.
      const fetchRequest=this.fetcher;
      const response=await fetchRequest(url,{...options,credentials:'include',signal:local.signal});
      return await readBody(response);
    }catch(error){
      if(this.controller.signal.aborted)throw new Error('Download cancelado.');
      if(local.signal.aborted)throw new Error('A fonte não respondeu em '+Math.round(this.requestTimeoutMs/1000)+' segundos.');
      throw error;
    }finally{
      clearTimeout(timeout);
      this.controller.signal.removeEventListener('abort',abort);
    }
  }

  async fetchText(url) {
    if(playlistExpiry(url)==='expired')
      throw new Error('O link HLS expirou. Recarregue a página e capture uma playlist nova.');
    return this.timedRequest(url,{},async res=>{
      if(res.status===401||res.status===403)
        throw new Error('HTTP '+res.status+' na playlist: o servidor recusou a requisição fora do player. Uma resposta anterior no navegador não garante permissão de download.');
      if(!res.ok)throw new Error('Erro HTTP '+res.status+' na playlist. Atualize a página e verifique a disponibilidade.');
      const data=await res.text();
      if(data.length>4*1024*1024)throw new Error('Manifesto HLS grande demais.');
      return data;
    });
  }

  async inspect(url = this.url) {
    const text = await this.fetchText(url);
    if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Manifesto HLS inválido.');
    if (text.includes('#EXT-X-STREAM-INF:')) {
      const variants = parseMaster(text, url);
      if (!variants.length) throw new Error('Master playlist sem qualidades.');
      this.variants = variants;
      return { variants };
    }
    return { media: parseMedia(text, url) };
  }

  async prepare(preferredUrl = null) {
    // Always inspect the original master first: clients must not inject a different playlist URL.
    const initial=await this.inspect(this.url);
    if(initial.media){
      if(preferredUrl&&preferredUrl!==this.url)
       throw new Error('Esta fonte HLS possui apenas uma qualidade.');
      this.parsed=initial.media;
      return initial.media;
    }
    const available=initial.variants.filter(variant=>!variant.separateAudio);
    if(!available.length)
      throw new Error('Todas as qualidades HLS usam áudio separado. Use o assistente local com FFmpeg.');
    const chosen=preferredUrl?
      available.find(variant=>variant.url===preferredUrl):available[0];
    if(!chosen)throw new Error('Qualidade indisponível no manifesto atual. Atualize a lista de qualidades.');
    const inner=await this.inspect(chosen.url);
    if(!inner.media)throw new Error('Playlists HLS aninhadas não suportadas.');
    this.parsed=inner.media;
    return inner.media;
  }

  async requestPart(part) {
    const headers=part.range?{Range:`bytes=${part.range[0]}-${part.range[1]}`}:{};
    let lastError;
    for(let attempt=0;attempt<3;attempt++){
      try{
        return await this.timedRequest(part.url,{headers},async response=>{
          if(response.status===401||response.status===403){
            const error=new Error('HTTP '+response.status+' no segmento. O CDN negou a transferência.');
            error.accessDenied=true;
            throw error;
          }
          if(!response.ok)throw new Error('HTTP '+response.status+' no segmento.');
          if(part.range&&response.status!==206)throw new Error('Servidor ignorou Range; não é seguro concatenar.');
          const bytes=new Uint8Array(await response.arrayBuffer());
          if(!bytes.length)throw new Error('Segmento vazio.');
          return bytes;
        });
      }catch(error){
        lastError=error;
        if(this.controller.signal.aborted||error.accessDenied)throw error;
        if(attempt!==2)await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
      }
    }
    throw lastError;
  }

  async download(onProgress = () => {}) {
    if (!this.parsed) await this.prepare();
    const { segments, extension } = this.parsed;
    if (segments.length > 10000) throw new Error('Playlist grande demais para esta versão.');
    const parts = [];
    let lastMapKey = '';
    for (const segment of segments) {
      if (segment.map) {
        const key = JSON.stringify(segment.map);
        if (key !== lastMapKey) parts.push(segment.map);
        lastMapKey = key;
      }
      parts.push(segment);
    }
    const chunks = new Array(parts.length);
    let next = 0;
    let completed = 0;
    let totalBytes = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, parts.length) }, async () => {
      while (next < parts.length && !this.controller.signal.aborted) {
        const index = next++;
        const data = await this.requestPart(parts[index]);
        chunks[index] = data;
        totalBytes += data.byteLength;
        if (totalBytes > this.maxBytes) {
          this.cancel();
          throw new Error('Limite de memória de 450 MB atingido. Use um gerenciador local para arquivos grandes.');
        }
        onProgress({ done: ++completed, total: parts.length, bytes: totalBytes });
      }
    });
    await Promise.all(workers);
    if (this.controller.signal.aborted) throw new Error('Download cancelado.');
    if (chunks.some(chunk => !chunk)) throw new Error('Arquivo incompleto. Nenhum download parcial será salvo.');
    return { blob: new Blob(chunks, { type: extension === 'ts' ? 'video/mp2t' : extension === 'mp4' ? 'video/mp4' : 'application/octet-stream' }), extension };
  }

  // Write HLS segments sequentially to OPFS. No video-size cap or full-Blob buffering.
  // Keeps RAM usage proportional to one network segment, not to the whole movie.
  async downloadToWriter(writer,onProgress=()=>{}){
    if(!this.parsed)await this.prepare();
    if(!writer||typeof writer.write!=='function')throw new Error('Gravador de arquivo ausente.');
    const {segments,extension}=this.parsed;
    let lastMapKey='',total=segments.length;
    for(const segment of segments)if(segment.map){
      const mapKey=JSON.stringify(segment.map);
      if(mapKey!==lastMapKey)total++;
      lastMapKey=mapKey;
    }
    let done=0,bytes=0;
    lastMapKey='';
    for(const segment of segments){
      if(this.controller.signal.aborted)throw new Error('Download cancelado.');
      if(segment.map){
       const mapKey=JSON.stringify(segment.map);
       if(mapKey!==lastMapKey){
        const chunk=await this.requestPart(segment.map);
        await writer.write(chunk);
        bytes+=chunk.byteLength;onProgress({done:++done,total,bytes});
       }
       lastMapKey=mapKey;
      }
      const chunk=await this.requestPart(segment);
      await writer.write(chunk);
      bytes+=chunk.byteLength;onProgress({done:++done,total,bytes});
    }
    if(this.controller.signal.aborted||done!==total)
     throw new Error('Arquivo interrompido ou incompleto.');
    return {bytes,extension};
  }

  cancel() {
    this.controller.abort();
  }
}
