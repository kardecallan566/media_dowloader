const list=document.getElementById('list');
let tabId=null;
function elt(tag,klass,text){const x=document.createElement(tag);x.className=klass||'';x.textContent=text||'';return x;}
async function render(){
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});tabId=tab?.id;
 const response=await chrome.runtime.sendMessage({cmd:'getMediaForTab',tabId});
 list.replaceChildren();
 if(!response?.items?.length){list.append(elt('div','empty-state','Nenhuma mídia encontrada. Aguarde o carregamento do player; alguns sites exigem iniciar a reprodução.'));return;}
 for(const item of response.items){
  const card=elt('div','media-card');
  const title=elt('div','media-title',item.tabTitle||'Mídia');
  const meta=elt('div','media-meta',item.type+' • '+new Date(item.time).toLocaleTimeString());
  const url=elt('div','media-url',item.url);url.title=item.url;
  const status=elt('div','',item.message||'');
  status.style.cssText='font-size:11px;color:#94a3b8;margin:8px 0';
  const meter=elt('progress','','');meter.max=100;meter.value=item.progress||0;meter.style.width='100%';
  const button=elt('button','btn-action btn-primary',item.type==='DASH'?'DASH ainda não suportado':item.status==='running'?'Baixando...':'Baixar vídeo');
  button.disabled=item.type==='DASH'||item.status==='running'||item.status==='saving';
  button.onclick=async()=>{button.disabled=true;const result=await chrome.runtime.sendMessage({cmd:'startDownload',tabId,id:item.id});
   if(!result?.ok)alert(result?.error||'Erro de download');await render();};
  card.append(title,meta,url,status,meter,button);
  if(item.status==='running'){const cancel=elt('button','btn-action','Cancelar');cancel.onclick=()=>chrome.runtime.sendMessage({cmd:'cancelDownload',id:item.id});card.append(cancel);}
  list.append(card);
 }
}
document.getElementById('refresh').onclick=()=>render();
document.getElementById('clear').onclick=async()=>{if(tabId!=null)await chrome.runtime.sendMessage({cmd:'clearMediaForTab',tabId});await render();};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.mediaStore)render().catch(console.error);});
render().catch(console.error);
