import { normalizedUrl, mediaType, mediaKey, shouldIgnoreNetwork, ranking, fileExtension } from './media-utils.js';

const STORE='mediaStore';
let operations=Promise.resolve();
const serial=(work)=>{const task=operations.then(work);operations=task.catch(()=>{});return task;};
const validTab=id=>Number.isInteger(id)&&id>=0;
const clean=s=>String(s||'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,160);
const running=s=>['running','downloading','saving'].includes(s);

async function updateBadge(tabId,list) {
 if(!validTab(tabId))return;
 const count=list.filter(x=>x.source==='page'&&x.visible&&x.status!=='canceled').length;
 await chrome.action.setBadgeText({tabId,text:count?(count>9?'9+':String(count)):''}).catch(()=>{});
 if(count)await chrome.action.setBadgeBackgroundColor({tabId,color:'#7764f6'}).catch(()=>{});
}
async function tabTitle(tabId) {
 try {return (await chrome.tabs.get(tabId)).title||'Mídia';}catch{return 'Mídia';}
}
async function saveCandidates(tabId,rawItems,source,frameId=0,snapshot=false) {
 if(!validTab(tabId)||!Array.isArray(rawItems)||(!rawItems.length&&!snapshot))return;
 const title=await tabTitle(tabId);
 await serial(async()=>{
  const {mediaStore={}}=await chrome.storage.local.get(STORE);
  const key=String(tabId),list=mediaStore[key]||[];
  const indexed=new Map(list.filter(i=>i.key).map(i=>[i.key,i]));
  let changed=false;
  if(snapshot){
   const currentKeys=new Set(rawItems.filter(x=>x?.visible).map(x=>{
    const url=normalizedUrl(x.url),type=url?mediaType(url,x.contentType||''):null;
    return type?mediaKey(url,type):null;
   }).filter(Boolean));
   for(const old of list){
    if(old.source==='page'&&old.frameId===frameId&&old.visible&&!currentKeys.has(old.key)){
     old.visible=false;changed=true;
    }
   }
  }
  for(const input of rawItems.slice(0,45)){
   const url=normalizedUrl(input?.url);
   if(!url)continue;
   const type=mediaType(url,input.contentType||'');
   if(!type || (source==='network'&&shouldIgnoreNetwork(url,type)))continue;
   const identity=mediaKey(url,type);
   let found=indexed.get(identity)||list.find(i=>i.url===url);
   const visible=source==='page'&&input.visible===true;
   if(found){
    if(source==='page'&&(found.source!=='page'||found.visible!==visible||found.frameId!==frameId)){
     found.source='page';found.visible=visible;found.frameId=frameId;
     found.thumbnail=normalizedUrl(input.thumbnail)||found.thumbnail;
     found.label=clean(input.label)||found.label;
     found.duration=Number.isFinite(input.duration)&&input.duration>0?input.duration:found.duration;
     found.width=Number(input.width)||found.width;
     found.height=Number(input.height)||found.height;
     changed=true;
    }
    if(found.url!==url){found.url=url;changed=true;}
    if(!found.key){found.key=identity;changed=true;}
    continue;
   }
   const item={
    id:crypto.randomUUID(),key:identity,url,type,source,visible,frameId,
    tabTitle:title,label:clean(input.label),contentType:clean(input.contentType),
    thumbnail:normalizedUrl(input.thumbnail)||null,
    duration:Number.isFinite(input.duration)&&input.duration>0?Math.round(input.duration):null,
    width:Number(input.width)||null,height:Number(input.height)||null,
    time:new Date().toISOString(),status:'ready',progress:0,message:''
   };
   list.push(item);indexed.set(identity,item);changed=true;
  }
  if(!changed)return;
  // Background network captures are available on demand, not promoted to primary media.
  const priority=list.sort((a,b)=>(running(b.status)?10000:ranking(b))-(running(a.status)?10000:ranking(a.status))||new Date(b.time)-new Date(a.time));
  const primary=priority.filter(i=>i.source==='page').slice(0,55);
  const network=priority.filter(i=>i.source!=='page').slice(0,90);
  mediaStore[key]=[...primary,...network];
  await chrome.storage.local.set({mediaStore});
  await updateBadge(tabId,mediaStore[key]);
 });
}
async function patchMedia(tabId,id,patch) {
 if(!validTab(tabId))return;
 await serial(async()=>{
  const {mediaStore={}}=await chrome.storage.local.get(STORE);
  const item=(mediaStore[String(tabId)]||[]).find(i=>i.id===id);
  if(!item)return;
  for(const key of ['status','progress','message','downloadId'])if(patch[key]!==undefined)item[key]=patch[key];
  await chrome.storage.local.set({mediaStore});
 });
}
async function getItem(tabId,id) {
 const {mediaStore={}}=await chrome.storage.local.get(STORE);
 return (mediaStore[String(tabId)]||[]).find(item=>item.id===id);
}
async function clearTab(tabId) {
 if(!validTab(tabId))return;
 await serial(async()=>{
  const {mediaStore={}}=await chrome.storage.local.get(STORE);
  delete mediaStore[String(tabId)];
  await chrome.storage.local.set({mediaStore});
 });
 await chrome.action.setBadgeText({tabId,text:''}).catch(()=>{});
}
function filename(item){
 const ext=fileExtension(item);
 if(!ext)throw new Error('Formato de arquivo não identificado com segurança.');
 const base=(item.label||item.tabTitle||'Midia').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,70)||'Midia';
 return `MediaFinder/${base}_${item.id.slice(0,6)}.${ext}`;
}
async function startDownload(tabId,id){
 const item=await getItem(tabId,id);
 if(!item)throw new Error('Arquivo não encontrado nesta aba.');
 if(running(item.status))throw new Error('Este arquivo já está sendo baixado.');
 if(item.type==='DASH')throw new Error('DASH exige montagem de áudio/vídeo e ainda não está disponível.');
 if(item.type!=='HLS'){
  const downloadId=await chrome.downloads.download({url:item.url,filename:filename(item),saveAs:false,conflictAction:'uniquify'});
  await patchMedia(tabId,id,{status:'downloading',progress:0,message:'Baixando pelo Chrome...',downloadId});
  // Handle downloads that finished before the persistence step.
  const [entry]=await chrome.downloads.search({id:downloadId});
  if(entry?.state==='complete')await patchMedia(tabId,id,{status:'done',progress:100,message:'Arquivo salvo na pasta Downloads.'});
  else if(entry?.state==='interrupted')await patchMedia(tabId,id,{status:'error',message:'Download interrompido pelo navegador.'});
  return {ok:true};
 }
 if(!await chrome.offscreen.hasDocument())await chrome.offscreen.createDocument({
  url:'offscreen.html',reasons:['BLOBS'],justification:'Processar HLS VOD fora da janela do popup'
 });
 await patchMedia(tabId,id,{status:'running',progress:0,message:'Preparando segmentos...'});
 try{
  const reply=await chrome.runtime.sendMessage({cmd:'runHlsJob',id,tabId,url:item.url,title:item.label||item.tabTitle});
  if(!reply?.ok)throw new Error(reply?.error||'Não foi possível iniciar HLS.');
  return {ok:true};
 }catch(err){await patchMedia(tabId,id,{status:'error',message:err.message});throw err;}
}
async function cancelDownload(tabId,id){
 const item=await getItem(tabId,id);
 if(!item)throw new Error('Download não encontrado.');
 if(item.downloadId!==undefined&&item.status==='downloading'){
  await chrome.downloads.cancel(item.downloadId);
  await patchMedia(tabId,id,{status:'canceled',message:'Download cancelado.'});
 }else if(item.type==='HLS'){
  await chrome.runtime.sendMessage({cmd:'cancelJob',id});
 }
 return {ok:true};
}
chrome.webRequest.onHeadersReceived.addListener(details=>{
 if(!validTab(details.tabId))return;
 const headers=details.responseHeaders||[];
 const mime=headers.find(h=>h.name.toLowerCase()==='content-type')?.value||'';
 const type=mediaType(details.url,mime);
 if(shouldIgnoreNetwork(details.url,type))return;
 // Ignore preview/partial requests when clearly segments; keep full progressive MP4.
 saveCandidates(details.tabId,[{url:details.url,contentType:mime}], 'network').catch(console.warn);
},{urls:['<all_urls>']},['responseHeaders']);

chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(msg?.cmd==='runHlsJob'||msg?.cmd==='cancelJob')return false; // offscreen owns these.
 (async()=>{
  if(msg.cmd==='onMediaDetected' || msg.cmd==='mediaSnapshot'){
   const list=msg.cmd==='mediaSnapshot'?msg.items:[msg];
   await saveCandidates(sender.tab?.id,list,'page',sender.frameId||0,msg.cmd==='mediaSnapshot');
   return {ok:true};
  }
  if(msg.cmd==='getMediaForTab'){
   const {mediaStore={}}=await chrome.storage.local.get(STORE);
   return {items:mediaStore[String(msg.tabId)]||[]};
  }
  if(msg.cmd==='clearMediaForTab'){await clearTab(msg.tabId);return {ok:true};}
  if(msg.cmd==='jobUpdate'){await patchMedia(msg.tabId,msg.patch.id,msg.patch);return {ok:true};}
  if(msg.cmd==='startDownload')return startDownload(msg.tabId,msg.id);
  if(msg.cmd==='cancelDownload')return cancelDownload(msg.tabId,msg.id);
  return {ok:false,error:'Comando desconhecido'};
 })().then(respond,error=>respond({ok:false,error:error.message||String(error)}));
 return true;
});
chrome.downloads.onChanged.addListener(async delta=>{
 if(!delta.state)return;
 await serial(async()=>{
  const {mediaStore={}}=await chrome.storage.local.get(STORE);
  let modified=false;
  for(const list of Object.values(mediaStore))for(const item of list){
   if(item.downloadId!==delta.id)continue;
   if(delta.state.current==='complete'){
    Object.assign(item,{status:'done',progress:100,message:'Arquivo salvo na pasta Downloads.'});
   }else if(delta.state.current==='interrupted'&&item.status!=='canceled'){
    Object.assign(item,{status:'error',message:'Transferência interrompida.'});
   }
   modified=true;
  }
  if(modified)await chrome.storage.local.set({mediaStore});
 }).catch(console.warn);
});
chrome.tabs.onRemoved.addListener(id=>clearTab(id).catch(()=>{}));
chrome.tabs.onUpdated.addListener((id,changes)=>{
 if(changes.url)clearTab(id).catch(console.warn);
});
chrome.runtime.onInstalled.addListener(details=>{
 if(details.reason==='update'&&String(details.previousVersion||'').startsWith('1.2.')){
  // Old 1.2 network entries were not source-tagged and flood the new interface.
  chrome.storage.local.remove(STORE).catch(console.warn);
 }
});
