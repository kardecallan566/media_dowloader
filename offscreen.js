import { StreamDownloader } from './hls-downloader.js';

const jobs = new Map();
const emit = (tabId, patch) => chrome.runtime.sendMessage({cmd:'jobUpdate',tabId,patch}).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.cmd === 'cancelJob') {
    jobs.get(message.id)?.cancel();
    respond({ok:true});
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
        emit(message.tabId,{id:message.id,status:'done',progress:100,message:`Transferido ao Chrome (#${downloadId}).`});
      } finally {
        setTimeout(()=>URL.revokeObjectURL(url),120000);
      }
    } catch (error) {
      emit(message.tabId,{id:message.id,status:job.controller.signal.aborted?'canceled':'error',message:error.message||String(error)});
    } finally {
      jobs.delete(message.id);
    }
  })();
  return true;
});
