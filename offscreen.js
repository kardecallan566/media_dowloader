import { StreamDownloader } from './hls-downloader.js';
import { parseRange, validateCompleteVideo } from './download-check.js';
import { downloadRangesToWriter } from './range-downloader.js';
import { openTemporaryMedia } from './opfs-store.js';
import { transcodeImage, safeImageFilename } from './image-converter.js';

const jobs = new Map();
const emit = (tabId, patch) => chrome.runtime.sendMessage({cmd:'jobUpdate',tabId,patch}).catch(() => {});

// Offscreen documents have chrome.runtime, but not the chrome.downloads API.
// Chrome download actions belong to the extension service worker.
const savedBlobs = new Map();
const earlyCompletions=new Map();
function keepBlobUntilSaved(downloadId,url,cleanup=()=>{}){
 const timeout=setTimeout(()=>freeBlob(downloadId),30*60*1000);
 savedBlobs.set(downloadId,{url,timeout,cleanup});
 if(earlyCompletions.has(downloadId)){
  clearTimeout(earlyCompletions.get(downloadId));
  earlyCompletions.delete(downloadId);
  freeBlob(downloadId);
 }
}
function markBlobSaved(downloadId){
 if(savedBlobs.has(downloadId))return freeBlob(downloadId);
 // Chrome may finish before saveBlob() has received its downloadId.
 // Keep an early completion briefly; do not leak a permanent entry.
 if(earlyCompletions.has(downloadId))return;
 const timeout=setTimeout(()=>earlyCompletions.delete(downloadId),30*1000);
 earlyCompletions.set(downloadId,timeout);
}
function freeBlob(downloadId){
 const entry=savedBlobs.get(downloadId);
 if(!entry)return;
 savedBlobs.delete(downloadId);
 clearTimeout(entry.timeout);
 URL.revokeObjectURL(entry.url);
 Promise.resolve(entry.cleanup()).catch(()=>{});
}
async function saveBlob(message,blobUrl,filename,cleanup=()=>{}){
 const result=await chrome.runtime.sendMessage({
  cmd:'saveBlobDownload',tabId:message.tabId,id:message.id,url:blobUrl,filename
 });
 if(!result?.ok||!Number.isInteger(result.downloadId))
  throw new Error(result?.error||'Não foi possível salvar o arquivo pelo Chrome.');
 keepBlobUntilSaved(result.downloadId,blobUrl,cleanup);
 if(result.state==='complete'||result.state==='interrupted')freeBlob(result.downloadId);
 return result.downloadId;
}


async function inspectPlayback(url,expectedDuration){
 const video=document.createElement('video');
 video.preload='metadata';video.muted=true;
 const duration=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>finish(new Error('Não foi possível ler a duração do arquivo em 12 segundos.')),12000);
  function finish(error,value){
   clearTimeout(timeout);video.removeEventListener('loadedmetadata',ready);
   video.removeEventListener('error',failed);
   if(error)reject(error);else resolve(value);
  }
  function ready(){finish(null,video.duration);}
  function failed(){finish(new Error('O navegador não conseguiu abrir o arquivo como vídeo completo.'));}
  video.addEventListener('loadedmetadata',ready,{once:true});
  video.addEventListener('error',failed,{once:true});
  video.src=url;video.load();
 });
 video.removeAttribute('src');video.load();
 if(!Number.isFinite(duration)||duration<0.5)throw new Error('O vídeo não possui duração reproduzível (possível quadro isolado).');
 if(Number.isFinite(expectedDuration)&&expectedDuration>2 && duration<expectedDuration*0.85)
  throw new Error('Vídeo parcial: duração recebida '+duration.toFixed(1)+'s; player informa '+expectedDuration.toFixed(1)+'s.');
 return duration;
}

async function runDirectVideo(message,controller){
 let temporary=null,objectUrl=null,queued=false;
 try{
  emit(message.tabId,{id:message.id,status:'running',progress:0,
   message:'Gravando vídeo no armazenamento temporário, sem limite fixo de tamanho...'});
  temporary=await openTemporaryMedia(message.id);
  let written=0,firstBytes=new Uint8Array(0),lastProgressAt=0;
  const update=bytes=>{
   const now=Date.now();
   if(now-lastProgressAt>450){
    lastProgressAt=now;
    emit(message.tabId,{id:message.id,status:'running',
      progress:message.expectedBytes?Math.min(89,Math.round(bytes/message.expectedBytes*89)):0,
      message:'Recebidos '+(bytes/1048576).toFixed(1)+' MB'});
   }
  };
  if(message.strategy==='ranges'){
    if(!Number.isSafeInteger(message.expectedBytes)||message.expectedBytes<65536)
     throw new Error('Tamanho total inválido para download por intervalos.');
    const info=await downloadRangesToWriter(message.url,message.expectedBytes,temporary.writer,{
      signal:controller.signal,onProgress:p=>update(p.bytes)});
    written=info.bytes;
  }else{
    const response=await fetch(message.url,{credentials:'include',cache:'no-store',redirect:'follow',signal:controller.signal});
    const range=parseRange(response.headers.get('content-range'));
    if(response.status<200||response.status>=300)throw new Error('Download HTTP '+response.status);
    if(range?.partial||(response.status===206&&!range))
     throw new Error('Servidor retornou apenas um fragmento em vez do arquivo completo.');
    const mime=(response.headers.get('content-type')||'').toLowerCase();
    if(!mime.startsWith('video/'))throw new Error('O servidor não enviou um vídeo.');
    if(!response.body)throw new Error('Resposta de vídeo vazia.');
    const reader=response.body.getReader();
    try{
     while(true){
      const {done,value}=await reader.read();
      if(done)break;
      if(controller.signal.aborted)throw new Error('Download cancelado.');
      if(!firstBytes.length)firstBytes=value.slice(0,64);
      await temporary.writer.write(value);
      written+=value.byteLength;
      update(written);
     }
    }finally{await reader.cancel().catch(()=>{});}
    if(message.expectedBytes&&written!==message.expectedBytes)
     throw new Error('Download incompleto: '+written+' de '+message.expectedBytes+' bytes.');
  }
  if(controller.signal.aborted)throw new Error('Download cancelado.');
  const {file,cleanup}=await temporary.finish();
  if(file.size!==written||file.size<16384)throw new Error('Arquivo incompleto ou pequeno demais.');
  const signature=firstBytes.length?firstBytes:new Uint8Array(await file.slice(0,64).arrayBuffer());
  const valid=message.extension==='webm'?
   (signature[0]===0x1a&&signature[1]===0x45&&signature[2]===0xdf&&signature[3]===0xa3):
   String.fromCharCode(...signature.slice(4,8))==='ftyp';
  if(!valid)throw new Error('Cabeçalho de vídeo inválido.');
  objectUrl=URL.createObjectURL(file);
  emit(message.tabId,{id:message.id,status:'running',progress:92,message:'Verificando duração do vídeo salvo...'});
  const duration=await inspectPlayback(objectUrl,message.duration||null);
  emit(message.tabId,{id:message.id,status:'saving',progress:96,
   message:'Vídeo reproduzível ('+duration.toFixed(1)+'s). Transferindo ao Chrome...'});
  const safe=(message.title||'video').normalize('NFKD').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,70)||'video';
  await saveBlob(message,objectUrl,'MediaFinder/'+safe+'_'+message.id.slice(0,6)+'.'+message.extension,cleanup);
  queued=true;
 }catch(error){
  if(objectUrl&&!queued)URL.revokeObjectURL(objectUrl);
  if(temporary&&!queued)await temporary.cleanup();
  emit(message.tabId,{id:message.id,status:controller.signal.aborted?'canceled':'blocked',
   message:error.message||String(error)});
 }finally{jobs.delete(message.id);}
}

async function runImageConversion(message,controller){
 let objectUrl=null,queued=false;
 try{
  await emit(message.tabId,{id:message.id,status:'running',progress:15,
   message:'Lendo a imagem original...'});
  const result=await transcodeImage(message.url,{
   format:message.format,quality:message.quality,signal:controller.signal
  });
  if(controller.signal.aborted)throw new Error('Conversão cancelada.');
  await emit(message.tabId,{id:message.id,status:'saving',progress:90,
   message:'Imagem '+result.width+'×'+result.height+' convertida para '+
    result.format.toUpperCase()+'. Salvando...'});
  objectUrl=URL.createObjectURL(result.blob);
  await saveBlob(message,objectUrl,safeImageFilename(message.title,message.id,result.format));
  queued=true;
 }catch(error){
  if(objectUrl&&!queued)URL.revokeObjectURL(objectUrl);
  await emit(message.tabId,{id:message.id,
   status:controller.signal.aborted?'canceled':'error',
   message:error.message||String(error)});
 }finally{
  jobs.delete(message.id);
 }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if(message.cmd==='savedBlobFinished'){
   markBlobSaved(message.downloadId);
   respond({ok:true});
   return;
  }
  if(message.cmd==='inspectHlsJob'){
   (async()=>{
    try{
     const downloader=new StreamDownloader(message.url);
     const result=await downloader.inspect();
     const variants=result.variants?
      result.variants.map(v=>({url:v.url,resolution:v.resolution,bandwidth:v.bandwidth,
       separateAudio:Boolean(v.separateAudio)})):
      [{url:message.url,resolution:'Qualidade única',bandwidth:0,separateAudio:false}];
     respond({ok:true,variants});
    }catch(error){respond({ok:false,error:error.message||String(error)});}
   })();
   return true;
  }
  if (message.cmd === 'cancelJob') {
    jobs.get(message.id)?.cancel();
    respond({ok:true});
    return;
  }
  if(message.cmd==='runImageJob'){
    if(jobs.has(message.id)){
      respond({ok:false,error:'Esta imagem já está em processamento.'});return;
    }
    const controller=new AbortController();
    jobs.set(message.id,{cancel:()=>controller.abort()});
    respond({ok:true});
    runImageConversion(message,controller);
    return;
  }
  if (message.cmd === 'runDirectJob') {
    if(jobs.has(message.id)){respond({ok:false,error:'Já existe download em andamento.'});return;}
    const controller=new AbortController();
    jobs.set(message.id,{cancel:()=>controller.abort()});
    respond({ok:true});
    runDirectVideo(message,controller);
    return;
  }
  if (message.cmd !== 'runHlsJob') return;
  if (jobs.has(message.id)) { respond({ok:false,error:'Download já está em andamento.'}); return; }
  const job = new StreamDownloader(message.url);
  jobs.set(message.id, job);
  respond({ok:true});
  (async () => {
    try {
      emit(message.tabId,{id:message.id,status:'running',progress:0,message:'Lendo manifesto...'});
      const prepared = await job.prepare(message.selectedUrl || null);
      emit(message.tabId,{id:message.id,status:'running',message:`Baixando ${prepared.segments.length} segmentos...`});
      let temp=null,url=null,queued=false;
      try{
        temp=await openTemporaryMedia(message.id);
        const result=await job.downloadToWriter(temp.writer,p=>emit(message.tabId,{
          id:message.id,status:'running',progress:Math.round(p.done/p.total*92),
          message:`${p.done}/${p.total} segmentos · ${(p.bytes/1048576).toFixed(1)} MB`
        }));
        if(job.controller.signal.aborted)throw new Error('Download cancelado.');
        const {file,cleanup}=await temp.finish();
        if(file.size!==result.bytes)throw new Error('O vídeo não foi gravado integralmente.');
        emit(message.tabId,{id:message.id,status:'saving',progress:96,message:'Salvando arquivo em disco...'});
        url=URL.createObjectURL(file);
        const safe=(message.title||'video').normalize('NFKD').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,90);
        await saveBlob(message,url,`MediaFinder/${safe||'video'}.${result.extension}`,cleanup);
        queued=true;
      }finally{
        if(temp&&!queued){
          if(url)URL.revokeObjectURL(url);
          await temp.cleanup();
        }
      }
    } catch (error) {
      emit(message.tabId,{id:message.id,status:job.controller.signal.aborted?'canceled':'error',message:error.message||String(error)});
    } finally {
      jobs.delete(message.id);
    }
  })();
  return true;
});
