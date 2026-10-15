// Media Finder Pro - MV3 service worker
const STORAGE_KEY = 'mediaStore';
const MAX_ITEMS = 75;
let queue = Promise.resolve();
const normalize = value => {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch { return null; }
};
const classify = (url, mime = '') => {
  const path = new URL(url).pathname.toLowerCase();
  const ct = mime.toLowerCase();
  if (/\.m3u8$/.test(path) || /(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl))/.test(ct)) return 'HLS';
  if (/\.mpd$/.test(path) || ct.includes('dash+xml')) return 'DASH';
  if (/\.(?:mp4|webm|mov|m4v)$/.test(path) || /^video\//.test(ct)) return 'Video';
  if (/\.(?:mp3|m4a|aac|ogg|wav)$/.test(path) || /^audio\//.test(ct)) return 'Audio';
  return null;
};
function mutate(task) {
  const pending = queue.then(task);
  queue = pending.catch(()=>{});
  return pending;
}
async function storeMedia(tabId, item) {
  const url=normalize(item.url);
  if (!Number.isInteger(tabId) || tabId<0 || !url) return;
  const type=classify(url,item.contentType||'');
  if (!type) return;
  return mutate(async()=>{
    const {mediaStore={}}=await chrome.storage.local.get(STORAGE_KEY);
    const key=String(tabId),list=mediaStore[key]||[];
    if (list.some(m=>m.url===url)) return;
    let title=item.tabTitle||'Mídia detectada';
    try { const tab=await chrome.tabs.get(tabId); title=tab.title||title; } catch {}
    list.unshift({id:crypto.randomUUID(),url,type,tabTitle:title,time:new Date().toISOString(),
      status:'ready',progress:0,message:''});
    mediaStore[key]=list.slice(0,MAX_ITEMS);
    await chrome.storage.local.set({mediaStore});
    await chrome.action.setBadgeText({tabId,text:String(mediaStore[key].length)}).catch(()=>{});
    await chrome.action.setBadgeBackgroundColor({tabId,color:'#8b5cf6'}).catch(()=>{});
  });
}
async function updateJob(tabId,patch) {
  return mutate(async()=>{
    const {mediaStore={}}=await chrome.storage.local.get(STORAGE_KEY);
    const list=mediaStore[String(tabId)]||[];
    const item=list.find(m=>m.id===patch.id);
    if (!item) return;
    Object.assign(item,{status:patch.status||item.status,progress:patch.progress??item.progress,
      message:patch.message??item.message});
    await chrome.storage.local.set({mediaStore});
  });
}
chrome.webRequest.onHeadersReceived.addListener(details=>{
  const headers=details.responseHeaders||[];
  const mime=headers.find(h=>h.name.toLowerCase()==='content-type')?.value||'';
  if (!classify(details.url,mime)) return;
  const pathname=new URL(details.url).pathname.toLowerCase();
  if (/\.(ts|m4s|cmfv|cmfa)$/.test(pathname) || /[?&]range=/.test(details.url)) return;
  storeMedia(details.tabId,{url:details.url,contentType:mime}).catch(console.warn);
},{urls:['<all_urls>']},['responseHeaders']);
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  (async()=>{
    if (msg.cmd==='onMediaDetected') {
      await storeMedia(sender.tab?.id,{url:msg.url,tabTitle:msg.tabTitle});
      return {ok:true};
    }
    if (msg.cmd==='getMediaForTab') {
      const {mediaStore={}}=await chrome.storage.local.get(STORAGE_KEY);
      return {items:mediaStore[String(msg.tabId)]||[]};
    }
    if (msg.cmd==='clearMediaForTab') {
      await mutate(async()=>{
        const {mediaStore={}}=await chrome.storage.local.get(STORAGE_KEY);
        delete mediaStore[String(msg.tabId)];
        await chrome.storage.local.set({mediaStore});
      });
      await chrome.action.setBadgeText({tabId:msg.tabId,text:''});
      return {ok:true};
    }
    if (msg.cmd==='jobUpdate') { await updateJob(msg.tabId,msg.patch); return {ok:true}; }
    if (msg.cmd==='startDownload') {
      const tabId=msg.tabId;
      const {mediaStore={}}=await chrome.storage.local.get(STORAGE_KEY);
      const item=(mediaStore[String(tabId)]||[]).find(i=>i.id===msg.id);
      if (!item) throw new Error('Mídia não encontrada.');
      if (item.status==='running' || item.status==='saving') throw new Error('Já está baixando.');
      if (item.type==='DASH') throw new Error('DASH exige muxing de áudio/vídeo; suporte em desenvolvimento.');
      if (item.type==='Video' || item.type==='Audio') {
        const extension=new URL(item.url).pathname.split('.').pop().toLowerCase();
        const ext=/^(mp4|webm|mov|m4v|mp3|m4a|aac|ogg|wav)$/.test(extension)?extension:(item.type==='Audio'?'mp3':'mp4');
        const name=(item.tabTitle||'media').normalize('NFKD').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,90);
        const downloadId=await chrome.downloads.download({url:item.url,filename:`MediaFinder/${name||'media'}.${ext}`,saveAs:false});
        await updateJob(tabId,{id:item.id,status:'done',progress:100,message:`Download iniciado (#${downloadId})`});
        return {ok:true};
      }
      if (!await chrome.offscreen.hasDocument()) await chrome.offscreen.createDocument({
        url:'offscreen.html', reasons:['BLOBS'], justification:'Baixar e agrupar segmentos HLS sem depender da janela popup'
      });
      await updateJob(tabId,{id:item.id,status:'running',progress:0,message:'Iniciando download...'});
      const response=await chrome.runtime.sendMessage({cmd:'runHlsJob',id:item.id,tabId,url:item.url,
        selectedUrl:msg.selectedUrl||null,title:item.tabTitle});
      if (!response?.ok) throw new Error(response?.error||'Falha ao iniciar processo.');
      return {ok:true};
    }
    if (msg.cmd==='cancelDownload') {
      await chrome.runtime.sendMessage({cmd:'cancelJob',id:msg.id});
      return {ok:true};
    }
    return {ok:false};
  })().then(reply,error=>reply({ok:false,error:error.message||String(error)}));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId=>mutate(async()=>{
  const {mediaStore={}}=await chrome.storage.local.get(STORAGE_KEY);
  delete mediaStore[String(tabId)];
  await chrome.storage.local.set({mediaStore});
}).catch(console.warn));
