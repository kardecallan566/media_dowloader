// Pure helpers shared by the popup and background. Keep signed download URLs intact.
const VIDEO = new Set(['mp4','webm','mov','m4v','ogv']);
const AUDIO = new Set(['mp3','m4a','aac','ogg','oga','wav','flac','opus']);
const IMAGE = new Set(['jpg','jpeg','png','webp','gif','avif','bmp']);
const EXT_MIME = {
 'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','video/ogg':'ogv',
 'audio/mpeg':'mp3','audio/mp4':'m4a','audio/aac':'aac','audio/ogg':'ogg',
 'audio/wav':'wav','audio/x-wav':'wav','audio/flac':'flac',
 'image/jpeg':'jpg','image/png':'png','image/webp':'webp',
 'image/gif':'gif','image/avif':'avif','image/bmp':'bmp'
};
export function normalizedUrl(raw, base) {
 try {
  const u = new URL(raw,base);
  return (u.protocol==='https:'||u.protocol==='http:') ? u.href : null;
 } catch { return null; }
}
export function mediaType(raw, mime='') {
 const url=normalizedUrl(raw);
 if(!url)return null;
 const u=new URL(url), ext=(u.pathname.match(/\.([a-z0-9]{2,5})$/i)||[])[1]?.toLowerCase();
 const contentType=String(mime||'').split(';')[0].trim().toLowerCase();
 if (ext==='m3u8'||contentType==='application/vnd.apple.mpegurl'||contentType==='application/x-mpegurl')return 'HLS';
 if (ext==='mpd'||contentType==='application/dash+xml')return 'DASH';
 if (VIDEO.has(ext)||contentType.startsWith('video/'))return 'Video';
 if (AUDIO.has(ext)||contentType.startsWith('audio/'))return 'Audio';
 if (IMAGE.has(ext)||contentType.startsWith('image/'))return 'Image';
 return null;
}
export function group(type){return ['HLS','DASH','Video'].includes(type)?'video':type==='Audio'?'audio':type==='Image'?'image':null;}
const STRIP=new Set(['expires','expire','exp','token','signature','sig','policy','key-pair-id','x-amz-signature','x-amz-date','x-amz-credential','x-amz-security-token','x-amz-expires']);
export function mediaKey(url,type) {
 const u=new URL(url);
 // Query values such as "id" or "url" can identify different files and must remain.
 for(const key of [...u.searchParams.keys()])if(STRIP.has(key.toLowerCase()))u.searchParams.delete(key);
 u.hash='';
 // Instagram CDN hostnames vary by edge; keep the complete asset path.
 const host=/(^|\.)cdninstagram\.com$/.test(u.hostname)?'cdninstagram.com':u.hostname;
 return `${group(type)||type}:${host}${u.pathname}${u.search}`;
}
export function fileExtension(item) {
 const type=item.type,mime=String(item.contentType||'').split(';')[0].toLowerCase();
 if(type==='HLS'||type==='DASH')return null;
 const path=new URL(item.url).pathname,ext=(path.match(/\.([a-z0-9]{2,5})$/i)||[])[1]?.toLowerCase();
 const allowed=type==='Image'?IMAGE:type==='Audio'?AUDIO:VIDEO;
 if(ext&&allowed.has(ext))return ext;
 return EXT_MIME[mime]||null;
}
export function shouldIgnoreNetwork(url,type) {
 if(!type||type==='Image')return true; // DOM-only images: network thumbnails cause huge noise.
 const u=new URL(url);
 if(/\.(ts|m4s|cmfv|cmfa|m4f|vtt|srt)$/i.test(u.pathname))return true;
 if(u.searchParams.has('range')||u.searchParams.has('bytes'))return true;
 return false;
}
export function ranking(item) {
 const active=item.status==='running'||item.status==='saving'||item.status==='downloading';
 return (active?1000:0)+(item.source==='page'?300:0)+(item.visible?120:0)+
 (item.type==='HLS'?40:0)+(item.type==='Video'?35:0)+(item.type==='DASH'?10:0);
}
export function sortMedia(items) {
 return [...items].sort((a,b)=>ranking(b)-ranking(a)||new Date(b.time)-new Date(a.time));
}
