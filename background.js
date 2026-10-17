import { normalizedUrl, mediaType, mediaKey, shouldIgnoreNetwork, ranking, fileExtension } from './media-utils.js';
import { validateProbe, parseRange } from './download-check.js';
import { evaluateRangedPreview } from './range-downloader.js';
import { canonicalMediaPageUrl } from './media-page.js';
import { contextualSource, signedExpiry } from './download-routing.js';

const STORE='mediaStore';
let operations=Promise.resolve();
const serial=(work)=>{const task=operations.then(work);operations=task.catch(()=>{});return task;};
const validTab=id=>Number.isInteger(id)&&id>=0;
const clean=s=>String(s||'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,160);
const running=s=>['checking','running','downloading','saving','native-connecting','native-running'].includes(s);
const nativePorts=new Map();
const offscreenDownloadIds=new Set();
const AUDIO_FORMATS=new Set(['mp3-128','mp3-192','mp3-320','m4a','opus']);
function validateAudioProfile(profile){
 if(!AUDIO_FORMATS.has(profile))throw new Error('Formato de áudio inválido.');
 return profile;
}


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
   let found=indexed.get(identity)||(type==='Player'?null:list.find(i=>i.type===type&&i.url===url));
   const visible=source==='page'&&input.visible===true;
   if(found){
    if(source==='page'&&type==='Player'){
     const nextPage=canonicalMediaPageUrl(input.pageUrl);
     if(found.pageUrl!==nextPage){
      found.pageUrl=nextPage;
      if(found.status==='error'){found.status='ready';found.message='';found.progress=0;}
      changed=true;
     }
     for(const field of ['label','thumbnail','engine','note','trackVideo','trackAudio','duration']){
      const value=input[field];
      if(value!==undefined&&value!==found[field]){
       found[field]=field==='label'||field==='note'||field==='engine'?clean(value):value;
       changed=true;
      }
     }
    }
    if(source==='network'&&input.responseStatus&&
     (found.responseStatus!==input.responseStatus || found.requestKind!==input.requestKind)){
     found.responseStatus=input.responseStatus;
     found.responseRange=clean(input.contentRange);
     found.responseLength=Number(input.contentLength)||null;
     found.requestKind=clean(input.requestKind);
     found.requestOrigin=normalizedUrl(input.requestOrigin)||null;
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
    if(found.url!==url){
     found.url=url;
     // Signed CDN URLs can rotate while referring to the same media identity.
     // A newly authorized URL must not inherit an old HTTP 403 or expiry result.
     if(!running(found.status)){
      found.status='ready';found.message='';found.analysis=null;found.progress=0;
      found.downloadId=undefined;
     }
     changed=true;
    }
    if(!found.key){found.key=identity;changed=true;}
    continue;
   }
   const item={
    id:crypto.randomUUID(),key:identity,url,type,source,visible,frameId,
    pageUrl:type==='Player'?canonicalMediaPageUrl(input.pageUrl):null,
    playerId:clean(input.playerId),engine:clean(input.engine),note:clean(input.note),
    trackVideo:Number(input.trackVideo)||0,trackAudio:Number(input.trackAudio)||0,
    sourceKind:clean(input.sourceKind),quality:clean(input.quality),
    tabTitle:title,label:clean(input.label),contentType:clean(input.contentType),
    thumbnail:normalizedUrl(input.thumbnail)||null,
    duration:Number.isFinite(input.duration)&&input.duration>0?Math.round(input.duration):null,
    width:Number(input.width)||null,height:Number(input.height)||null,
    responseStatus:input.responseStatus||null,responseRange:clean(input.contentRange),
    responseLength:Number(input.contentLength)||null,requestKind:clean(input.requestKind),
    requestOrigin:normalizedUrl(input.requestOrigin)||null,
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
  if(type==='Video'&&result.state==='uncertain'&&result.size
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

async function startDownload(tabId,id,selectedUrl=null){
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
  if(item.type==='Video'&&analysis.size&&['mp4','webm'].includes(extension)){
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
  if(analysis.state==='range')throw new Error('Esta fonte não ofereceu intervalos verificáveis de um arquivo completo.');
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
  const reply=await chrome.runtime.sendMessage({cmd:'runHlsJob',id,tabId,url:item.url,title:item.label||item.tabTitle,
   selectedUrl:selectedUrl||null});
  if(!reply?.ok)throw new Error(reply?.error||'Não foi possível iniciar HLS.');
  return {ok:true};
 }catch(err){await patchMedia(tabId,id,{status:'error',message:err.message});throw err;}
}
async function getHlsQualities(tabId,id){
 const item=await getItem(tabId,id);
 if(!item||item.type!=='HLS')throw new Error('Selecione uma playlist HLS detectada.');
 if(signedExpiry(item.url)?.expired)throw new Error('A playlist expirou. Atualize a página.');
 if(!await chrome.offscreen.hasDocument())await chrome.offscreen.createDocument({
  url:'offscreen.html',reasons:['BLOBS'],justification:'Ler resoluções do manifesto HLS'
 });
 const result=await chrome.runtime.sendMessage({cmd:'inspectHlsJob',url:item.url});
 if(!result?.ok)throw new Error(result?.error||'Falha ao analisar qualidades.');
 return {ok:true,variants:result.variants};
}
function supportedNativePage(url){
 try{
  const target=new URL(url);
  const host=target.hostname.toLowerCase();
  return target.protocol==='https:'&&
   ['instagram.com','youtube.com','youtube-nocookie.com','youtu.be','pinterest.com']
    .some(domain=>host===domain||host.endsWith('.'+domain));
 }catch{return false;}
}
async function startNativeDownload(tabId,id,cookiesBrowser=null,manualUrl=null,quality='best',audioProfile=null) {
 if(audioProfile!==null){
  validateAudioProfile(audioProfile);
  if(quality!=='best')throw new Error('Resolução de vídeo não se aplica à extração de áudio.');
 }
 if(!['best','2160','1440','1080','720','480','360'].includes(quality))
  throw new Error('Qualidade inválida.');
 if(![null,'brave','firefox'].includes(cookiesBrowser))throw new Error('Navegador de sessão inválido.');
 const item=await getItem(tabId,id);
 if(!item||item.type!=='Player')throw new Error('Selecione um player de vídeo reconhecido.');
 if(running(item.status))throw new Error('Já existe um download em andamento.');
 if(!item.visible||item.source!=='page')throw new Error('O player não está mais visível nesta página. Atualize a detecção.');
 const tab=await chrome.tabs.get(tabId);
 const page=canonicalMediaPageUrl(tab.url);
 const manual=manualUrl ? canonicalMediaPageUrl(manualUrl) : null;
 if(manualUrl && !manual)throw new Error('Cole uma URL de Reel ou post válida, não um link do feed.');
 const url=manual||canonicalMediaPageUrl(item.pageUrl)||page;
 if(!url){
  const message='Não identifiquei o link desta publicação. Abra o Reel/post em sua página própria (instagram.com/reel/... ou /p/...) e tente novamente.';
  await patchMedia(tabId,id,{status:'error',message});
  throw new Error(message);
 }
 if(!supportedNativePage(url))throw new Error('URL do vídeo não permitida para o assistente.');
 if(tab.url){
  const tabHost=new URL(tab.url).hostname.replace(/^www\./,'');
  const targetHost=new URL(url).hostname.replace(/^www\./,'');
  const instagram=host=>host==='instagram.com';
  const youtube=host=>['youtube.com','m.youtube.com','music.youtube.com','youtu.be','youtube-nocookie.com'].includes(host);
  const pinterest=host=>host==='pinterest.com'||/^[a-z]{2}\.pinterest\.com$/.test(host);
  if(!(tabHost===targetHost||(instagram(tabHost)&&instagram(targetHost))||
    (youtube(tabHost)&&youtube(targetHost))||(pinterest(tabHost)&&pinterest(targetHost))))
   throw new Error('O link detectado não pertence à página atual.');
 }
 await patchMedia(tabId,id,{status:'native-connecting',progress:0,message:'Conectando ao assistente local...'});
 const port=chrome.runtime.connectNative('com.mediafinder.bridge');
 const key=id;
 const state={port,tabId,id,finished:false};
 nativePorts.set(key,state);
 port.onMessage.addListener(message=>{
  if(message.id!==id)return;
  if(message.type==='started'||message.type==='progress'){
   patchMedia(tabId,id,{status:'native-running',progress:message.progress??0,
    message:message.message||'Baixando mídia com processamento local...'}).catch(console.warn);
  }else if(message.type==='complete'){
   state.finished=true;
   patchMedia(tabId,id,{status:'done',progress:100,message:message.message||'Arquivo salvo pelo assistente local.'})
    .finally(()=>port.disconnect()).catch(console.warn);
  }else if(message.type==='error'){
   state.finished=true;
   patchMedia(tabId,id,{status:'error',message:message.message||'Erro no assistente local.'})
    .finally(()=>port.disconnect()).catch(console.warn);
  }
 });
 port.onDisconnect.addListener(()=>{
  if(nativePorts.get(key)===state)nativePorts.delete(key);
  if(!state.finished){
   const err=chrome.runtime.lastError?.message||'Conexão encerrada.';
   patchMedia(tabId,id,{status:'error',message:'Assistente local indisponível: '+err+
    ' Consulte native/README.md para instalar no Chrome ou Brave.'}).catch(console.warn);
  }
 });
 port.postMessage({cmd:'download',id,url,cookiesBrowser,quality,audioProfile});
 return {ok:true,pending:true};
}

async function startNativeSource(tabId,id,quality='best',audioProfile=null){
 if(audioProfile!==null){
  validateAudioProfile(audioProfile);
  if(quality!=='best')throw new Error('Resolução de vídeo não se aplica à extração de áudio.');
 }
 if(!['best','2160','1440','1080','720','480','360'].includes(quality))
  throw new Error('Qualidade inválida.');
 const item=await getItem(tabId,id);
 if(!item||!['Video','HLS'].includes(item.type))throw new Error('Escolha um arquivo de vídeo detectado nesta página.');
 if(running(item.status))throw new Error('Já existe uma transferência para este arquivo.');
 const tab=await chrome.tabs.get(tabId);
 const page=new URL(tab.url||'');
 const source=new URL(item.url);
 if(!contextualSource(tab.url,item.url,item.type))
  throw new Error('Download contextual indisponível para esta combinação de página e servidor.');
 if(item.source!=='network'&&item.source!=='page')throw new Error('Fonte não reconhecida nesta aba.');
 if(item.type==='HLS'&&signedExpiry(item.url)?.expired)
  throw new Error('Link HLS temporário expirado. Atualize a página para capturar um novo manifesto.');
 await patchMedia(tabId,id,{status:'native-connecting',message:'Tentando baixar com a referência da página...',progress:0});
 const port=chrome.runtime.connectNative('com.mediafinder.bridge');
 const state={port,tabId,id,finished:false};
 nativePorts.set(id,state);
 port.onMessage.addListener(msg=>{
  if(msg.id!==id)return;
  if(msg.type==='warning'){
   patchMedia(tabId,id,{status:'native-running',message:msg.message||'Tentando sem sessão...'}).catch(console.warn);
  }else if(msg.type==='started'||msg.type==='progress'){
   patchMedia(tabId,id,{status:'native-running',progress:msg.progress??0,
    message:msg.message||'Transferindo vídeo...'}).catch(console.warn);
  }else if(msg.type==='complete'||msg.type==='error'){
   state.finished=true;
   patchMedia(tabId,id,msg.type==='complete'?
    {status:'done',progress:100,message:msg.message||'Arquivo salvo.'}:
    {status:'error',message:msg.message||'O servidor não autorizou a transferência.'})
    .finally(()=>port.disconnect()).catch(console.warn);
  }
 });
 port.onDisconnect.addListener(()=>{
  if(nativePorts.get(id)===state)nativePorts.delete(id);
  if(!state.finished)patchMedia(tabId,id,{status:'error',
    message:'Assistente local indisponível: '+(chrome.runtime.lastError?.message||'conexão encerrada')}).catch(console.warn);
 });
 port.postMessage({cmd:'downloadSource',id,url:item.url,referrer:page.origin+page.pathname,
  quality:item.type==='HLS'?quality:'best',audioProfile});
 return {ok:true,pending:true};
}

async function cancelDownload(tabId,id){
 const item=await getItem(tabId,id);
 if(!item)throw new Error('Download não encontrado.');
 const native=nativePorts.get(id);
 if(native){
  native.finished=true;
  try{native.port.postMessage({cmd:'cancel',id});}catch{}
  native.port.disconnect();nativePorts.delete(id);
  await patchMedia(tabId,id,{status:'canceled',message:'Download local cancelado.'});
  return {ok:true};
 }
 if(item.downloadId!==undefined&&item.status==='downloading'){
  await chrome.downloads.cancel(item.downloadId);
  await patchMedia(tabId,id,{status:'canceled',message:'Download cancelado.'});
 }else if(['HLS','Video'].includes(item.type)&&
   ['checking','running','saving'].includes(item.status)){
  await chrome.runtime.sendMessage({cmd:'cancelJob',id}).catch(()=>{});
  await patchMedia(tabId,id,{status:'canceled',message:'Download cancelado pelo usuário.'});
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
   contentRange:header('content-range'),contentLength:header('content-length'),
   requestKind:details.type,requestOrigin:details.initiator||''
 }], 'network').catch(console.warn);
},{urls:['<all_urls>']},['responseHeaders']);

function validOffscreenSave(sender,msg){
 if(sender.tab||sender.url!==chrome.runtime.getURL('offscreen.html'))return false;
 if(!validTab(msg.tabId)||typeof msg.id!=='string'||msg.id.length>128)return false;
 if(typeof msg.url!=='string'||!msg.url.startsWith('blob:'+chrome.runtime.getURL('')))return false;
 return typeof msg.filename==='string'&&
  /^MediaFinder\/[a-zA-Z0-9_-]{1,100}\.(?:ts|mp4|webm|aac|mp3)$/.test(msg.filename);
}
async function saveOffscreenBlob(msg,sender){
 if(!validOffscreenSave(sender,msg))throw new Error('Solicitação inválida do processador auxiliar.');
 const item=await getItem(msg.tabId,msg.id);
 if(!item||!['running','saving'].includes(item.status))throw new Error('Download não está ativo.');
 const downloadId=await chrome.downloads.download({
  url:msg.url,filename:msg.filename,saveAs:false,conflictAction:'uniquify'
 });
 offscreenDownloadIds.add(downloadId);
 await patchMedia(msg.tabId,msg.id,{status:'downloading',progress:99,downloadId,
  message:'Arquivo montado; salvando pelo gerenciador do navegador...'});
 const [entry]=await chrome.downloads.search({id:downloadId});
 if(entry?.state==='complete'){
  await patchMedia(msg.tabId,msg.id,{status:'done',progress:100,message:'Arquivo salvo pelo Chrome.'});
 }else if(entry?.state==='interrupted'){
  await patchMedia(msg.tabId,msg.id,{status:'error',message:'O Chrome interrompeu o salvamento.'});
 }
 if(['complete','interrupted'].includes(entry?.state)&&offscreenDownloadIds.delete(downloadId))
  chrome.runtime.sendMessage({cmd:'savedBlobFinished',downloadId}).catch(()=>{});
 return {ok:true,downloadId,state:entry?.state||'in_progress'};
}

chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(['runHlsJob','runDirectJob','cancelJob','inspectHlsJob'].includes(msg?.cmd))return false; // offscreen owns these.
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
  if(msg.cmd==='saveBlobDownload')return saveOffscreenBlob(msg,sender);
  if(msg.cmd==='verifyMedia')return verifyAndSave(msg.tabId,msg.id,Boolean(msg.force));
  if(msg.cmd==='startDownload')return startDownload(msg.tabId,msg.id,msg.selectedUrl||null);
  if(msg.cmd==='getHlsQualities')return getHlsQualities(msg.tabId,msg.id);
  if(msg.cmd==='startNativeDownload')return startNativeDownload(msg.tabId,msg.id,msg.cookiesBrowser||null,msg.manualUrl||null,msg.quality||'best');
  if(msg.cmd==='startNativeAudio')return startNativeDownload(msg.tabId,msg.id,msg.cookiesBrowser||null,
   msg.manualUrl||null,'best',validateAudioProfile(msg.audioProfile));
  if(msg.cmd==='startNativeSource')return startNativeSource(msg.tabId,msg.id,msg.quality||'best');
  if(msg.cmd==='startNativeSourceAudio')return startNativeSource(msg.tabId,msg.id,'best',
   validateAudioProfile(msg.audioProfile));
  if(msg.cmd==='cancelDownload')return cancelDownload(msg.tabId,msg.id);
  return {ok:false,error:'Comando desconhecido'};
 })().then(respond,error=>respond({ok:false,error:error.message||String(error)}));
 return true;
});
chrome.downloads.onChanged.addListener(async delta=>{
 if(!delta.state)return;
 if(['complete','interrupted'].includes(delta.state.current)&&offscreenDownloadIds.delete(delta.id))
  chrome.runtime.sendMessage({cmd:'savedBlobFinished',downloadId:delta.id}).catch(()=>{});
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
 if(details.reason!=='update')return;
 if(['1.6.0','1.7.0','1.8.0'].includes(details.previousVersion)||
   String(details.previousVersion||'').startsWith('1.2.')){
  // Remove obsolete detector entries from older releases.
  chrome.storage.local.remove(STORE).catch(console.warn);
 }else if(['1.10.0','1.10.1'].includes(details.previousVersion)){
  // Reset stale HLS browser errors when a new native-first route is introduced.
  serial(async()=>{
   const {mediaStore={}}=await chrome.storage.local.get(STORE);
   let changed=false;
   for(const entries of Object.values(mediaStore)){
    for(const item of entries){
     if(item.type==='HLS'&&item.status==='error'&&
        /Illegal invocation|HTTP 40[13] na playlist/i.test(item.message||'')){
      item.status='ready';item.progress=0;item.analysis=null;
      item.message='Método de download atualizado. Use o botão principal para tentar o assistente local quando disponível.';
      changed=true;
     }
    }
   }
   if(changed)await chrome.storage.local.set({mediaStore});
  }).catch(console.warn);
 }
});
