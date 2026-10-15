import { group, sortMedia, fileExtension } from './media-utils.js';

const $=id=>document.getElementById(id);
const list=$('list');
let tabId=null;
let tabUrl='';
let active='video';
let items=[];
let expanded=false;
let moreLimit=10;
let refreshTimer=null;
let loading=false;
const names={video:'Vídeo',image:'Imagem',audio:'Áudio'};
const icons={video:'▶',image:'▧',audio:'♫'};
function node(tag,klass='',value=''){
 const result=document.createElement(tag);result.className=klass;result.textContent=value;return result;
}
function notify(message){$('toast').textContent=message||'';}
function timeLabel(seconds){
 const n=Math.round(Number(seconds));
 if(!Number.isFinite(n)||n<=0)return '';
 return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].filter((v,i)=>i>0||n>=3600).map(v=>String(v).padStart(2,'0')).join(':');
}
function label(item,index){
 const candidate=String(item.label||'').trim();
 if(candidate&&candidate.length<=45)return candidate;
 return `${names[group(item.type)]||'Arquivo'} ${index+1}`;
}
function hostName(item){
 try {const host=new URL(item.url).hostname;return host.endsWith('.cdninstagram.com')?'Instagram CDN':host.replace(/^www\./,'');}
 catch{return 'Fonte detectada';}
}
function statusText(item){
 if(item.status==='error')return item.message||'Falha no download';
 if(item.status==='canceled')return 'Download cancelado';
 if(item.status==='done')return item.message||'Download concluído';
 if(item.status==='running'||item.status==='saving'||item.status==='downloading')return item.message||'Processando download...';
 return '';
}
function preview(item){
 const kind=group(item.type);
 const wrap=node('div','preview',icons[kind]||'▶');
 const src=item.thumbnail || (kind==='image'?item.url:null);
 if(src){
  try{
   const url=new URL(src);
   if(url.protocol==='http:'||url.protocol==='https:'){
    const image=document.createElement('img');image.alt='Prévia da mídia';image.loading='lazy';
    image.onerror=()=>{image.remove();wrap.textContent=icons[kind]||'▶';};
    image.src=url.href;wrap.replaceChildren(image);
   }
  }catch{}
 }
 return wrap;
}
function mediaCard(item,index,{uncertain=false}={}){
 const kind=group(item.type);
 const card=node('article','media-card');
 const line=node('div','media-line');
 const main=node('div','media-main');
 const head=node('div','media-title',label(item,index));head.title=head.textContent;
 const chips=node('div','media-sub');
 const ext=fileExtension(item);
 chips.append(node('span','chip primary',item.type==='HLS'?'HLS':item.type==='DASH'?'DASH':(ext||'Arquivo').toUpperCase()));
 if(item.width&&item.height)chips.append(node('span','chip',`${item.width}×${item.height}`));
 if(item.duration)chips.append(node('span','chip',timeLabel(item.duration)));
 if(item.source==='page'&&item.visible)chips.append(node('span','chip','Na página'));
 const host=node('div','media-host',hostName(item));
 main.append(head,chips,host);line.append(preview(item),main);card.append(line);
 const status=statusText(item);
 if(status){
  card.append(node('div',item.status==='error'?'state error':'state',status));
  if(item.status==='running'||item.status==='saving'){
   const track=node('div','track');
   const fill=node('div','fill');fill.style.width=`${Math.max(0,Math.min(100,item.progress||0))}%`;
   track.append(fill);card.append(track);
  }
 }
 const actions=node('div','media-actions');
 const isRunning=['running','saving','downloading'].includes(item.status);
 const button=node('button','download-btn',isRunning?'Baixando...':item.status==='done'?'Baixar novamente':`Baixar ${names[kind]?.toLowerCase()||'arquivo'}`);
 const formatMissing=item.type!=='HLS'&&item.type!=='DASH'&&!ext;
 if(item.type==='DASH')button.textContent='DASH indisponível';
 if(formatMissing)button.textContent='Formato indisponível';
 button.disabled=isRunning||item.type==='DASH'||formatMissing;
 button.title=item.type==='DASH'?'O formato DASH precisa de um muxer de áudio e vídeo.':formatMissing?'Não foi possível identificar a extensão do arquivo.':'';
 button.onclick=async()=>{
  button.disabled=true;button.textContent='Preparando...';notify('');
  try{
   const result=await chrome.runtime.sendMessage({cmd:'startDownload',tabId,id:item.id});
   if(!result?.ok)throw new Error(result?.error||'Falha ao iniciar o download.');
   await load();
  }catch(error){notify(error.message);await load();}
 };
 actions.append(button);
 if(isRunning){
  const cancel=node('button','cancel-btn','Cancelar');
  cancel.onclick=async()=>{
   const res=await chrome.runtime.sendMessage({cmd:'cancelDownload',tabId,id:item.id});
   if(!res?.ok)notify(res?.error||'Não foi possível cancelar.');
   await load();
  };
  actions.append(cancel);
 }
 card.append(actions);
 const detail=document.createElement('details');
 const summary=document.createElement('summary');summary.textContent=uncertain?'Ver origem da fonte':'Detalhes técnicos';
 const url=node('div','raw-url',item.url);detail.append(summary,url);card.append(detail);
 return card;
}
function heading(name,hint=''){
 const row=node('div','section-heading');
 row.append(node('div','section-title',name),node('div','section-hint',hint));
 return row;
}
function emptyMessage(){
 const result=node('div','empty');
 result.append(node('div','empty-icon',icons[active]));
 result.append(node('strong','',`Nenhum ${names[active]?.toLowerCase()||'arquivo'} encontrado`));
 result.append(node('p','',active==='image'
 ?'Abra uma imagem na página ou role até ela para detectá-la.'
 :'Aguarde o carregamento do player. Alguns sites só liberam a fonte após dar Play.'));
 return result;
}
function render(){
 for(const tab of document.querySelectorAll('[data-kind]'))tab.classList.toggle('active',tab.dataset.kind===active);
 for(const kind of ['video','image','audio']){
  const count=items.filter(item=>group(item.type)===kind&&item.source==='page'&&item.visible).length;
  $(kind+'Count').textContent=count?String(Math.min(99,count)):'';
 }
 const choices=sortMedia(items.filter(item=>group(item.type)===active));
 const page=choices.filter(item=>item.source==='page'&&item.visible);
 const oldPage=choices.filter(item=>item.source==='page'&&!item.visible);
 const network=choices.filter(item=>item.source!=='page');
 const focus=(page.length?page:oldPage.length?oldPage:network).slice(0,page.length?5:2);
 const selected=new Set(focus.map(item=>item.id));
 const extra=[...page,...oldPage,...network].filter(item=>!selected.has(item.id));
 list.replaceChildren();
 if(!focus.length&&!extra.length){list.append(emptyMessage());return;}
 let headingText='Na página';
 if(!page.length)headingText=oldPage.length?'Detectado na página':'Possíveis arquivos';
 list.append(heading(headingText,`${focus.length} ${focus.length===1?'item':'itens'}`));
 const main=node('section','media-list');
 focus.forEach((item,index)=>main.append(mediaCard(item,index,{uncertain:item.source!=='page'})));
 list.append(main);
 if(!page.length&&!oldPage.length){
  list.append(node('div','notice','Estas fontes foram observadas nas requisições da página. O site pode carregar outros vídeos em segundo plano; confira a origem antes de baixar.'));
 }
 if(extra.length){
  const button=node('button','more-btn',expanded?'Ocultar outras fontes':`Ver outras fontes (${extra.length}) ▾`);
  button.onclick=()=>{expanded=!expanded;moreLimit=10;render();};
  list.append(button);
  if(expanded){
   list.append(heading('Outras fontes', 'Inclui arquivos pré-carregados'));
   const extraList=node('section','media-list');
   extra.slice(0,moreLimit).forEach((item,index)=>extraList.append(mediaCard(item,index+focus.length,{uncertain:true})));
   list.append(extraList);
   if(extra.length>moreLimit){
    const more=node('button','more-btn',`Mostrar mais ${Math.min(10,extra.length-moreLimit)} fontes`);
    more.onclick=()=>{moreLimit+=10;render();};
    list.append(more);
   }
  }
 }
 if(choices.some(item=>item.type==='HLS')){
  list.append(node('div','notice','Streams HLS podem ser salvos em formato TS; converter para MP4 pode exigir uma ferramenta externa.'));
 }
}
async function load(){
 if(tabId===null)return;
 if(loading)return;
 loading=true;
 try{
  const response=await chrome.runtime.sendMessage({cmd:'getMediaForTab',tabId});
  items=response?.items||[];
  render();
 }catch(error){notify('Falha ao atualizar: '+error.message);}
 finally{loading=false;}
}
async function rescan(){
 notify('');
 try{await chrome.tabs.sendMessage(tabId,{cmd:'rescanMedia'});}
 catch{} // Restricted browser pages have no content script.
 await new Promise(r=>setTimeout(r,260));
 await load();
}
document.querySelectorAll('[data-kind]').forEach(tab=>tab.addEventListener('click',()=>{
 active=tab.dataset.kind;expanded=false;moreLimit=10;render();
}));
$('refresh').onclick=()=>rescan();
$('clear').onclick=async()=>{
 const result=await chrome.runtime.sendMessage({cmd:'clearMediaForTab',tabId});
 if(!result?.ok){notify(result?.error||'Não foi possível limpar.');return;}
 items=[];expanded=false;render();await rescan();
};
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area==='local'&&changes.mediaStore){
  clearTimeout(refreshTimer);refreshTimer=setTimeout(load,100);
 }
});
(async()=>{
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id)throw new Error('Não foi possível identificar a aba atual.');
  tabId=tab.id;tabUrl=tab.url||'';
  $('pageTitle').textContent=tab.title||'Página atual';
  try{
   const url=new URL(tabUrl);
   $('pageAddress').textContent=url.hostname;
   $('pageInitial').textContent=url.hostname.replace(/^www\./,'')[0]?.toUpperCase()||'🌐';
  }catch{$('pageAddress').textContent='Página do navegador';}
  await load();
  await rescan();
 }catch(error){notify(error.message);}
})();
