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
const verifiedThisOpen=new Set();
const playerSourcesOpen=new Set();
let autoTimer=null;
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
 if(item.status==='native-connecting')return item.message||'Conectando ao assistente local...';
 if(item.status==='native-running')return item.message||'Baixando e montando o vídeo...';
 if(item.status==='checking')return 'Analisando tamanho, resposta HTTP e estrutura da mídia...';
 if(item.status==='blocked')return item.message||'Fonte parcial ou indisponível.';
 if(item.status==='error')return item.message||'Falha no download';
 if(item.status==='canceled')return 'Download cancelado';
 if(item.status==='done')return item.message||'Download concluído';
 if(item.type==='Player')return item.note||'Player encontrado, mas a fonte original ainda não foi identificada.';
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
function possibleSources(player){
 const host=(()=>{try{return new URL(player.url).hostname;}catch{return '';}})();
 const isInstagram=host==='instagram.com'||host.endsWith('.instagram.com');
 const isYoutube=host==='youtube.com'||host.endsWith('.youtube.com');
 return items.filter(candidate=>{
  if(candidate.id===player.id||candidate.type==='Player')return false;
  if(!['Video','HLS','DASH'].includes(candidate.type))return false;
  if(candidate.source==='page'&&candidate.playerId===player.playerId)return true;
  if(candidate.source!=='network')return false;
  try{
   const sourceHost=new URL(candidate.url).hostname;
   if(isInstagram)return sourceHost.endsWith('.cdninstagram.com')||sourceHost.endsWith('.fbcdn.net');
   if(isYoutube)return sourceHost==='googlevideo.com'||sourceHost.endsWith('.googlevideo.com');
   return true;
  }catch{return false;}
 }).sort((a,b)=>{
  const score=x=>(x.analysis?.canDownload?1000:0)+(x.type==='HLS'?300:0)
   +(x.responseRange?60:0)+(x.responseLength>65536?40:0)+(x.status==='blocked'?-100:0);
  return score(b)-score(a)||(new Date(b.time)-new Date(a.time));
 }).slice(0,8);
}

function mediaCard(item,index,{uncertain=false}={}){
 const kind=group(item.type);
 const card=node('article','media-card');
 const line=node('div','media-line');
 const main=node('div','media-main');
 const head=node('div','media-title',label(item,index));head.title=head.textContent;
 const chips=node('div','media-sub');
 const ext=fileExtension(item);
 chips.append(node('span','chip primary',item.type==='Player'?'PLAYER':item.type==='HLS'?'HLS':item.type==='DASH'?'DASH':(ext||'Arquivo').toUpperCase()));
 if(item.type==='Player'){
  chips.append(node('span','chip verified','Vídeo identificado'));
  if(item.engine)chips.append(node('span','chip',item.engine));
  if(item.trackVideo)chips.append(node('span','chip',item.trackVideo+' faixas de vídeo'));
  if(item.trackAudio)chips.append(node('span','chip',item.trackAudio+' faixas de áudio'));
 }
 if(item.sourceKind==='progressive')chips.append(node('span','chip verified','Áudio + vídeo'));
 if(item.width&&item.height)chips.append(node('span','chip',`${item.width}×${item.height}`));
 if(item.duration)chips.append(node('span','chip',timeLabel(item.duration)));
 if(item.source==='page'&&item.visible)chips.append(node('span','chip','Na página'));
 if(item.type==='Video'||item.type==='Audio'||item.type==='Image'){
  const analysis=item.analysis;
  if(analysis?.state==='likely')chips.append(node('span','chip verified','Download provável'));
  else if(analysis?.state==='partial'||item.status==='blocked')chips.append(node('span','chip warning','Fragmento / indisponível'));
  else if(analysis?.state==='unavailable')chips.append(node('span','chip warning','Acesso negado'));
  else if(analysis?.state==='uncertain')chips.append(node('span','chip warning','Não confirmado'));
  else if(item.responseStatus===206)chips.append(node('span','chip warning','Resposta 206'));
  else chips.append(node('span','chip','A verificar'));
 }
 const host=node('div','media-host',hostName(item));
 main.append(head,chips,host);line.append(preview(item),main);card.append(line);
 const status=statusText(item);
 if(status||item.analysis?.reason){
  card.append(node('div',['error','blocked'].includes(item.status)?'state error':'state',status||item.analysis?.reason));
  if(['running','saving','native-running'].includes(item.status)){
   const track=node('div','track');
   const fill=node('div','fill');fill.style.width=`${Math.max(0,Math.min(100,item.progress||0))}%`;
   track.append(fill);card.append(track);
  }
 }
 const actions=node('div','media-actions');
 const isRunning=['checking','running','saving','downloading','native-connecting','native-running'].includes(item.status);
 const blocked=item.type==='Player'||item.status==='blocked'||(item.analysis&&!item.analysis.canDownload);
 const candidates=item.type==='Player'?possibleSources(item):[];
 const button=node('button','download-btn',isRunning?'Verificando / baixando...':blocked?'Verificar novamente':item.status==='done'?'Baixar novamente':
  (item.type==='HLS'?'Baixar stream':item.analysis?.canDownload?`Baixar ${names[kind]?.toLowerCase()||'arquivo'}`:'Verificar e baixar'));
 const formatMissing=item.type!=='HLS'&&item.type!=='DASH'&&!ext;
 if(item.type==='Player')button.textContent=candidates.length?
  `Buscar fontes de download (${candidates.length})`:'Procurar fonte do vídeo';
 if(item.type==='DASH')button.textContent='DASH indisponível';
 if(formatMissing)button.textContent='Formato indisponível';
 button.disabled=isRunning||item.type==='DASH'||(formatMissing&&item.type!=='Player');
 button.title=item.type==='Player'?'Abrir possíveis fontes; é necessário conferir se pertencem ao vídeo atual.':
  item.type==='DASH'?'O formato DASH precisa de um muxer de áudio e vídeo.':
  formatMissing?'Não foi possível identificar a extensão do arquivo.':'';
 button.onclick=async()=>{
  if(item.type==='Player'){
   if(playerSourcesOpen.has(item.id))playerSourcesOpen.delete(item.id);
   else playerSourcesOpen.add(item.id);
   expanded=false;render();
   if(playerSourcesOpen.has(item.id)&&!candidates.length)rescan().catch(()=>{});
   return;
  }
  button.disabled=true;button.textContent='Preparando...';notify('');
  try{
   const cmd=blocked?'verifyMedia':'startDownload';
   const result=await chrome.runtime.sendMessage({cmd,tabId,id:item.id,force:blocked});
   if(!result?.ok)throw new Error(result?.error||'Não foi possível verificar o arquivo.');
   if(cmd==='verifyMedia'&&result.analysis?.canDownload)notify('Fonte aprovada na verificação. Clique em Baixar para continuar.');
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
 if(item.type==='Player' && (/instagram\.com|youtube\.com|youtu\.be/.test(tabUrl))){
  const nativeControls=node('div','media-actions native-actions');
  const nativeButton=node('button','download-btn local-download',isRunning?'Processando com assistente...':'Baixar completo com assistente local');
  nativeButton.disabled=isRunning;
  nativeButton.onclick=async()=>{
   nativeButton.disabled=true;nativeButton.textContent='Conectando...';notify('');
   try{
    const answer=await chrome.runtime.sendMessage({cmd:'startNativeDownload',tabId,id:item.id});
    if(!answer?.ok)throw new Error(answer?.error||'Não foi possível conectar ao assistente.');
   }catch(error){notify(error.message);}
   await load();
  };
  const help=node('button','cancel-btn','Configurar');
  help.title='Instruções de instalação do assistente local no Chrome ou Brave';
  help.onclick=()=>chrome.tabs.create({url:'https://github.com/kardecallan566/media_dowloader/blob/main/native/README.md'});
  nativeControls.append(nativeButton,help);
  card.append(nativeControls);
  card.append(node('div','notice','Opcional: utiliza yt-dlp e FFmpeg instalados no seu PC. Não contorna DRM e pode exigir acesso autorizado ao conteúdo.'));
 }
 const detail=document.createElement('details');
 const summary=document.createElement('summary');summary.textContent=uncertain?'Ver origem da fonte':'Detalhes técnicos';
 const url=node('div','raw-url',item.url);detail.append(summary,url);card.append(detail);
 if(item.type==='Player'&&playerSourcesOpen.has(item.id)){
  const panel=node('div','player-candidates');
  const all=possibleSources(item);
  panel.append(node('div','section-title',all.length?
   'Possíveis fontes encontradas':'Nenhum arquivo completo identificado ainda'));
  panel.append(node('div','notice',all.length?
   'As fontes vêm de requisições da página e podem ser de outros vídeos do feed. Verifique antes de baixar.':
   'O player usa blob/MSE. Reproduza brevemente e clique em Atualizar para tentar identificar as fontes; não precisa assistir até o fim.'));
  for(let i=0;i<all.length;i++){
   const candidate=all[i];
   panel.append(mediaCard({...candidate,label:candidate.label||`Fonte possível ${i+1}`},i,{uncertain:true}));
  }
  card.append(panel);
 }
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
 if(active==='video'&&/youtube\.com|youtu\.be/i.test(tabUrl))
  list.append(node('div','notice','No YouTube, o player usa frequentemente áudio e vídeo separados. A extensão identifica o vídeo e só oferece download direto quando há um arquivo com áudio e vídeo verificável.'));
 scheduleAutoVerify(focus);
}
function scheduleAutoVerify(focus){
 const candidates=focus.filter(item=>['Video','Audio','Image'].includes(item.type)&&
  !item.analysis?.checkedAt&&item.status==='ready'&&!verifiedThisOpen.has(item.id)).slice(0,2);
 for(const item of candidates)verifiedThisOpen.add(item.id);
 if(!candidates.length)return;
 autoTimer=setTimeout(async()=>{
  for(const candidate of candidates){
   await chrome.runtime.sendMessage({cmd:'verifyMedia',tabId,id:candidate.id}).catch(()=>{});
  }
 },300);
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
 verifiedThisOpen.clear();
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
