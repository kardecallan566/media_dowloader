import { StreamDownloader } from './hls-downloader.js';
import { parseRange, validateCompleteVideo } from './download-check.js';
import { downloadRanges, RANGE_MAX_BYTES } from './range-downloader.js';

const jobs = new Map();
const emit = (tabId, patch) => chrome.runtime.sendMessage({cmd:'jobUpdate',tabId,patch}).catch(() => {});

function releaseWhenChromeFinishes(downloadId, blobUrl) {
 let released=false;
 const cleanup=()=>{
  if(released)return;
  released=true;
  chrome.downloads.onChanged.removeListener(onChanged);
  clearTimeout(timeout);
  URL.revokeObjectURL(blobUrl);
 };
 const onChanged=delta=>{
  if(delta.id===downloadId && ['complete','interrupted'].includes(delta.state?.current))cleanup();
 };
 const timeout=setTimeout(cleanup,30*60*1000);
 chrome.downloads.onChanged.addListener(onChanged);
 chrome.downloads.search({id:downloadId}).then(([item])=>{
  if(item && ['complete','interrupted'].includes(item.state))cleanup();
 }).catch(()=>{});
}


const DIRECT_MAX_BYTES=96*1024*1024;

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
 let objectUrl=null;let downloadStarted=false;
 try{
  emit(message.tabId,{id:message.id,status:'running',progress:0,message:'Recebendo vídeo para conferir integridade...'});
  let bytes;
  let lastProgressAt=0;
  if(message.strategy==='ranges'){
   if(!Number.isSafeInteger(message.expectedBytes)||message.expectedBytes>RANGE_MAX_BYTES)
    throw new Error('Tamanho do recurso incompatível com a montagem por intervalos.');
   bytes=await downloadRanges(message.url,message.expectedBytes,{
    signal:controller.signal,
    onProgress:progress=>{
     const now=Date.now();
     if(now-lastProgressAt>400||progress.bytes===progress.total){
      lastProgressAt=now;
      emit(message.tabId,{id:message.id,status:'running',
       progress:Math.round(progress.bytes/progress.total*87),
       message:`Reunindo ${progress.partsDone}/${progress.parts} intervalos · ${(progress.bytes/1048576).toFixed(1)} MB`});
     }
    }
   });
  }else{
   const response=await fetch(message.url,{credentials:'include',cache:'no-store',redirect:'follow',signal:controller.signal});
   const contentRange=parseRange(response.headers.get('content-range'));
   if(response.status<200||response.status>=300)throw new Error('Download HTTP '+response.status);
   if(contentRange?.partial||(response.status===206&&!contentRange))
    throw new Error('O servidor enviou um trecho do vídeo, não o arquivo inteiro.');
   const mime=response.headers.get('content-type')||'';
   if(!mime.toLowerCase().startsWith('video/'))throw new Error('Servidor respondeu conteúdo que não é vídeo.');
   const reader=response.body?.getReader();
   if(!reader)throw new Error('Resposta do vídeo não contém dados.');
   const chunks=[];let received=0;
   try{
    while(true){
     const {done,value}=await reader.read();
     if(done)break;
     received+=value.length;
     if(received>DIRECT_MAX_BYTES)throw new Error('Vídeo excede o limite de validação de 96 MB.');
     chunks.push(value);
     const now=Date.now();
     if(now-lastProgressAt>450){
      lastProgressAt=now;
      emit(message.tabId,{id:message.id,status:'running',
       progress:message.expectedBytes?Math.min(87,Math.round(received/message.expectedBytes*87)):0,
       message:'Baixando e verificando: '+(received/1048576).toFixed(1)+' MB'});
     }
    }
   }finally{await reader.cancel().catch(()=>{});}
   if(message.expectedBytes&&received!==message.expectedBytes)
    throw new Error('Download incompleto: '+received+' de '+message.expectedBytes+' bytes esperados.');
   bytes=new Uint8Array(received);
   let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  }
  const check=validateCompleteVideo(bytes,message.extension);
  if(!check.ok)throw new Error(check.reason);
  const blob=new Blob([bytes],{type:message.extension==='webm'?'video/webm':'video/mp4'});
  emit(message.tabId,{id:message.id,status:'running',progress:91,message:'Conferindo a duração do vídeo...'});
  objectUrl=URL.createObjectURL(blob);
  const duration=await inspectPlayback(objectUrl,message.duration||null);
  emit(message.tabId,{id:message.id,status:'saving',progress:96,
   message:'Vídeo reproduzível ('+duration.toFixed(1)+'s). Salvando...'});
  const safe=(message.title||'video').normalize('NFKD').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,70)||'video';
  const downloadId=await chrome.downloads.download({url:objectUrl,
   filename:'MediaFinder/'+safe+'_'+message.id.slice(0,6)+'.'+message.extension,saveAs:false,conflictAction:'uniquify'});
  downloadStarted=true;
  releaseWhenChromeFinishes(downloadId,objectUrl);
  await emit(message.tabId,{id:message.id,status:'downloading',progress:99,downloadId,
   message:'Vídeo validado. Salvando na pasta Downloads...'});
  const [file]=await chrome.downloads.search({id:downloadId});
  if(file?.state==='complete')
   await emit(message.tabId,{id:message.id,status:'done',progress:100,message:'Vídeo íntegro salvo com sucesso.'});
 }catch(error){
  if(objectUrl&&!downloadStarted)URL.revokeObjectURL(objectUrl);
  emit(message.tabId,{id:message.id,status:controller.signal.aborted?'canceled':'blocked',
   message:error.message||String(error)});
 }finally{jobs.delete(message.id);}
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.cmd === 'cancelJob') {
    jobs.get(message.id)?.cancel();
    respond({ok:true});
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
      const result = await job.download(p => emit(message.tabId,{
        id:message.id,status:'running',progress:Math.round(p.done/p.total*95),
        message:`${p.done}/${p.total} segmentos · ${(p.bytes/1048576).toFixed(1)} MB`
      }));
      emit(message.tabId,{id:message.id,status:'saving',progress:97,message:'Salvando arquivo...'});
      const url = URL.createObjectURL(result.blob);
      try {
        const safe = (message.title || 'video').normalize('NFKD').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,90);
        const downloadId = await chrome.downloads.download({
          url,filename:`MediaFinder/${safe || 'video'}.${result.extension}`,saveAs:false,conflictAction:'uniquify'
        });
        releaseWhenChromeFinishes(downloadId,url);
        await emit(message.tabId,{id:message.id,status:'downloading',progress:99,downloadId,
          message:'Salvando arquivo no gerenciador do Chrome...'});
        const [entry]=await chrome.downloads.search({id:downloadId});
        if(entry?.state==='complete')await emit(message.tabId,{id:message.id,status:'done',progress:100,
          message:'Arquivo salvo na pasta Downloads.'});
        else if(entry?.state==='interrupted')await emit(message.tabId,{id:message.id,status:'error',
          message:'Transferência interrompida pelo navegador.'});
      } catch(error) {
        URL.revokeObjectURL(url);
        throw error;
      }
    } catch (error) {
      emit(message.tabId,{id:message.id,status:job.controller.signal.aborted?'canceled':'error',message:error.message||String(error)});
    } finally {
      jobs.delete(message.id);
    }
  })();
  return true;
});
