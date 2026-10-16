import { normalizedUrl, mediaType, mediaKey, shouldIgnoreNetwork, ranking, fileExtension } from './media-utils.js';
import { validateProbe, parseRange } from './download-check.js';
import { evaluateRangedPreview, RANGE_MAX_BYTES } from './range-downloader.js';

const STORE='mediaStore';
let operations=Promise.resolve();
const serial=(work)=>{const task=operations.then(work);operations=task.catch(()=>{});return task;};
const validTab=id=>Number.isInteger(id)&&id>=0;
const clean=s=>String(s||'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,160);
const running=s=>['checking','running','downloading','saving'].includes(s);

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
    const url=normalizedUrl(x.url),type=x.type==='Player'&&source==='page'?'Player':url?mediaType(url,x.contentType||''):null;
    return type&&url?mediaKey(url,type,x.playerId):null;
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
   const type=(source==='page'&&input.type==='Player')?'Player':mediaType(url,input.contentType||'');
   if(!type || (source==='network'&&shouldIgnoreNetwork(url,type)))continue;
   const identity=mediaKey(url,type,input.playerId);
   let found=indexed.get(identity)||list.find(i=>i.url===url);
   const visible=source==='page'&&input.visible===true;
   if(found){
    if(source==='page'&&type==='Player'){
     for(const field of ['label','thumbnail','engine','note','trackVideo','trackAudio','duration']){
      const value=input[field];
      if(value!==undefined&&value!==found[field]){
       found[field]=field==='label'||field==='note'||field==='engine'?clean(value):value;
       changed=true;
      }
     }
    }
    if(source==='network'&&input.responseStatus&&found.responseStatus!==input.responseStatus){
     found.responseStatus=input.responseStatus;
     found.responseRange=clean(input.contentRange);
     found.responseLength=Number(input.contentLength)||null;
     changed=true;
    }
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
    playerId:clean(input.playerId),engine:clean(input.engine),note:clean(input.note),
    trackVideo:Number(input.trackVideo)||0,trackAudio:Number(input.trackAudio)||0,
    sourceKind:clean(input.sourceKind),quality:clean(input.quality),
    tabTitle:title,label:clean(input.label),contentType:clean(input.contentType),
    thumbnail:normalizedUrl(input.thumbnail)||null,
    duration:Number.isFinite(input.duration)&&input.duration>0?Math.round(input.duration):null,
    width:Number(input.width)||null,height:Number(input.height)||null,
    responseStatus:input.responseStatus||null,responseRange:clean(input.contentRange),
    responseLength:Number(input.contentLength)||null,
    time:new Date().toISOString(),status:'ready',progress:0,message:'',analysis:null
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
  for(const key of ['status','progress','message','downloadId','analysis'])if(patch[key]!==undefined)item[key]=patch[key];
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

// Read at most 512 KiB and cancel the response stream: never download a full large video just to inspect it.
async function verifyFile(item,{force=false}={}){
 if(item.type==='Player')return {state:'blocked',canDownload:false,reason:'Player identificado sem URL de arquivo completo. Consulte possíveis fontes, ou aguarde implementação do muxer.'};
 if(item.type==='DASH')return {state:'blocked',canDownload:false,reason:'DASH com áudio/vídeo separados ainda não possui muxer.'};
 if(item.type==='HLS')return {state:'uncertain',canDownload:true,reason:'HLS VOD será conferido pelo analisador de playlist antes de baixar.'};
 const cached=item.analysis;
 if(!force&&cached&&cached.checkedAt&&Date.now()-cached.checkedAt<90_000)return cached;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),14000);
 let result;
 try {
  const response=await fetch(item.url,{
   method:'GET',credentials:'include',redirect:'follow',cache:'no-store',signal:controller.signal
  });
  const reader=response.body?.getReader();
  if(!reader)throw new Error('Servidor não retornou um corpo de resposta.');
  const chunks=[];let bytesRead=0;
  try{
   while(bytesRead<524288){
    const {done,value}=await reader.read();
    if(done)break;
    const slice=value.subarray(0,524288-bytesRead);
    chunks.push(slice);bytesRead+=slice.length;
   }
  }finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(bytesRead);
  let p=0;for(const chunk of chunks){bytes.set(chunk,p);p+=chunk.length;}
  const type=item.type,ext=fileExtension(item);
  result=validateProbe(response.status,response.headers,bytes,type,ext);
  if(response.status===206){
   const candidate=evaluateRangedPreview(response.status,response.headers,bytes,type,ext);
   if(candidate.canDownload)result=candidate;
  }
  if(type==='Video'&&result.state==='uncertain'&&result.size&&result.size<=RANGE_MAX_BYTES
    &&['mp4','webm'].includes(ext)&&response.status===200&&bytes.length>=12){
   const isMp4=ext==='mp4'&&String.fromCharCode(...bytes.subarray(4,8))==='ftyp';
   const isWebm=ext==='webm'&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
   if(isMp4||isWebm)result={...result,state:'likely',canDownload:true,
    reason:'Cabeçalho reconhecido; estrutura e duração serão conferidas após baixar todos os bytes.'};
  }
  result.checkedAt=Date.now();
  result.checkedBytes=bytesRead;
  if(response.redirected&&new URL(response.url).origin!==new URL(item.url).origin){
   // Redirects are accepted only if they resolve to real media, validated above.
   result.redirected=true;
  }
 }catch(error){
  result={state:'unavailable',canDownload:false,
   reason:error.name==='AbortError'?'Tempo esgotado ao verificar a mídia.':'Não foi possível verificar a fonte: '+error.message,
   checkedAt:Date.now()};
 }finally{clearTimeout(timeout);}
 return result;
}
async function verifyAndSave(tabId,id,force=false){
 const item=await getItem(tabId,id);
 if(!item)throw new Error('Mídia não encontrada.');
 if(running(item.status))return {ok:false,error:'O arquivo já está sendo processado.'};
 await patchMedia(tabId,id,{status:'checking',message:'Verificando se a URL oferece mídia completa...'});
 const analysis=await verifyFile(item,{force});
 await patchMedia(tabId,id,{analysis,status:analysis.canDownload?'ready':'blocked',message:analysis.reason});
 return {ok:true,analysis};
}

async function startDownload(tabId,id){
 const item=await getItem(tabId,id);
 if(!item)throw new Error('Arquivo não encontrado nesta aba.');
 if(running(item.status))throw new Error('Este arquivo já está sendo baixado.');
 if(item.type==='Player')throw new Error('Vídeo identificado no player, mas não há arquivo completo confirmado para baixar.');
 if(item.type==='DASH')throw new Error('DASH exige montagem de áudio/vídeo e ainda não está disponível.');
 if(item.type!=='HLS'){
  await patchMedia(tabId,id,{status:'checking',message:'Conferindo cabeçalho, tamanho e integridade inicial...'});
  const analysis=await verifyFile(item);
  if(!analysis.canDownload){
   await patchMedia(tabId,id,{analysis,status:'blocked',message:analysis.reason});
   throw new Error(analysis.reason);
  }
  await patchMedia(tabId,id,{analysis,status:'ready',message:analysis.reason});
  const extension=fileExtension(item);
  if(item.type==='Video'&&analysis.size&&analysis.size<=RANGE_MAX_BYTES&&['mp4','webm'].includes(extension)){
   if(!await chrome.offscreen.hasDocument())await chrome.offscreen.createDocument({
    url:'offscreen.html',reasons:['BLOBS'],justification:'Validar estrutura e duração de vídeos diretos antes de salvar'
   });
   await patchMedia(tabId,id,{status:'running',progress:0,message:'Baixando e validando vídeo completo...'});
   const reply=await chrome.runtime.sendMessage({cmd:'runDirectJob',
    id:item.id,tabId,url:item.url,title:item.label||item.tabTitle,
    extension,expectedBytes:analysis.size,duration:item.duration||null,
    strategy:analysis.state==='range'?'ranges':'single'});
   if(!reply?.ok){
    await patchMedia(tabId,id,{status:'error',message:reply?.error||'Falha no verificador de vídeo.'});
    throw new Error(reply?.error||'Falha no verificador de vídeo.');
   }
   return {ok:true};
  }
  if(analysis.state==='range')throw new Error('Esta fonte exige montagem por intervalos; arquivo acima do limite seguro.');
  let downloadId;
  try {
   downloadId=await chrome.downloads.download({url:item.url,filename:filename(item),saveAs:false,conflictAction:'uniquify'});
  }catch(err){
   await patchMedia(tabId,id,{status:'error',message:'O Chrome não conseguiu iniciar o download: '+err.message});
   throw err;
  }
  await patchMedia(tabId,id,{status:'downloading',progress:0,message:'Baixando pelo Chrome (fonte verificada)...',downloadId});
  // Handle downloads that finished before the persistence step.
  const [entry]=await chrome.downloads.search({id:downloadId});
  if(entry?.state==='complete'){
   const size=entry.fileSize||entry.bytesReceived||0;
   const mismatch=analysis.size&&size&&size!==analysis.size;
   await patchMedia(tabId,id,mismatch?
     {status:'error',message:'Arquivo salvo com tamanho divergente ('+size+' versus '+analysis.size+' bytes). Pode ser parcial.'}:
     {status:'done',progress:100,message:'Download concluído. Confira a reprodução do arquivo.'});
  }
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
 const header=name=>headers.find(h=>h.name.toLowerCase()===name)?.value||'';
 const mime=header('content-type');
 const type=mediaType(details.url,mime);
 if(shouldIgnoreNetwork(details.url,type))return;
 // Ignore preview/partial requests when clearly segments; keep full progressive MP4.
 saveCandidates(details.tabId,[{
   url:details.url,contentType:mime,responseStatus:details.statusCode,
   contentRange:header('content-range'),contentLength:header('content-length')
 }], 'network').catch(console.warn);
},{urls:['<all_urls>']},['responseHeaders']);

chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(['runHlsJob','runDirectJob','cancelJob'].includes(msg?.cmd))return false; // offscreen owns these.
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
  if(msg.cmd==='verifyMedia')return verifyAndSave(msg.tabId,msg.id,Boolean(msg.force));
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
    // A completed Chrome transfer is not proof that the server sent the entire media.
    const expected=item.analysis?.size;
    const [file]=await chrome.downloads.search({id:delta.id});
    const received=file?.fileSize||file?.bytesReceived||null;
    const mismatch=expected&&received&&expected!==received;
    Object.assign(item,mismatch?
      {status:'error',message:'Tamanho do arquivo diferente do esperado ('+received+'/'+expected+' bytes). Possível fragmento.'}:
      {status:'done',progress:100,message:'Transferência concluída. Verifique a reprodução.'});
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
