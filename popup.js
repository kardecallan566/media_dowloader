import { group, sortMedia, fileExtension } from './media-utils.js';
import { canonicalMediaPageUrl } from './media-page.js';
import { contextualSource, preferredDownloadMethod } from './download-routing.js';
import { AUDIO_PROFILES, canExtractAudioFromVideo } from './audio-support.js';
import { youtubePlaylistUrl } from './youtube-playlist.js';

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
const sessionChoices=new Map();
const pastedPostUrls=new Map();
const chosenNativeQuality=new Map();
const chosenAudioProfile=new Map();
const hlsQualityList=new Map();
const hlsSelectedVariant=new Map();
const imageOutputSelection=new Map();
const imageQualitySelection=new Map();
let imageOutputDefault='original';
let imageQualityDefault=0.92;
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
 const isPinterest=host==='pinterest.com'||host.endsWith('.pinterest.com');
 return items.filter(candidate=>{
  if(candidate.id===player.id||candidate.type==='Player')return false;
  if(!['Video','HLS','DASH'].includes(candidate.type))return false;
  if(candidate.source==='page'&&candidate.playerId===player.playerId)return true;
  if(candidate.source!=='network')return false;
  try{
   const sourceHost=new URL(candidate.url).hostname;
   if(isInstagram)return sourceHost.endsWith('.cdninstagram.com')||sourceHost.endsWith('.fbcdn.net');
   if(isYoutube)return sourceHost==='googlevideo.com'||sourceHost.endsWith('.googlevideo.com');
   if(isPinterest)return sourceHost==='pinimg.com'||sourceHost.endsWith('.pinimg.com');
   return true;
  }catch{return false;}
 }).sort((a,b)=>{
  const score=x=>(x.analysis?.canDownload?1000:0)+(x.type==='HLS'?300:0)
   +(x.responseRange?60:0)+(x.responseLength>65536?40:0)+(x.status==='blocked'?-100:0);
  return score(b)-score(a)||(new Date(b.time)-new Date(a.time));
 }).slice(0,8);
}

function contextualSourceAvailable(item){
 return Boolean(contextualSource(tabUrl,item.url,item.type));
}
function hlsExpired(item){
 return item.type==='HLS'&&preferredDownloadMethod(tabUrl,item)==='expired';
}


function nativeQualitySelector(item){
 const wrapper=node('div','quality-panel');
 wrapper.append(node('label','quality-label','Qualidade do vídeo'));
 const select=document.createElement('select');
 select.className='quality-select';
 const options=[['best','Melhor disponível (original)'],['2160','Até 2160p (4K)'],
  ['1440','Até 1440p (2K)'],['1080','Até 1080p (Full HD)'],
  ['720','Até 720p (HD)'],['480','Até 480p'],['360','Até 360p']];
 for(const [value,description] of options){
  const option=document.createElement('option');option.value=value;
  option.textContent=description;select.append(option);
 }
 select.value=chosenNativeQuality.get(item.id)||'best';
 select.onchange=()=>chosenNativeQuality.set(item.id,select.value);
 wrapper.append(select,node('div','notice',
  'A qualidade escolhida depende das faixas disponíveis. Se não existir uma faixa compatível, o download informa o erro.'));
 return wrapper;
}
function hlsQualitySelector(item){
 const panel=node('div','quality-panel');
 const current=hlsQualityList.get(item.id);
 if(current?.error){
  panel.append(node('div','notice',current.error));
 }
 if(current?.variants){
  panel.append(node('label','quality-label','Qualidade HLS disponível'));
  const select=document.createElement('select');select.className='quality-select';
  const base=document.createElement('option');base.value='';base.textContent='Automática (melhor com áudio)';
  select.append(base);
  for(const variant of current.variants){
   const option=document.createElement('option');
   option.value=variant.url;
   const bandwidth=variant.bandwidth?' · '+(variant.bandwidth/1e6).toFixed(1)+' Mb/s':'';
   option.textContent=(variant.resolution||'Resolução automática')+bandwidth+
    (variant.separateAudio?' · áudio separado':'');
   option.disabled=variant.separateAudio;
   select.append(option);
  }
  select.value=hlsSelectedVariant.get(item.id)||'';
  if(![...select.options].some(o=>o.value===select.value&&!o.disabled))select.value='';
  select.onchange=()=>hlsSelectedVariant.set(item.id,select.value);
  panel.append(select);
 }else{
  const load=node('button','cancel-btn','Consultar qualidades disponíveis');
  load.onclick=async()=>{
   load.disabled=true;load.textContent='Consultando manifesto...';
   try{
    const response=await chrome.runtime.sendMessage({cmd:'getHlsQualities',tabId,id:item.id});
    if(!response?.ok)throw new Error(response?.error||'Não foi possível consultar a playlist.');
    hlsQualityList.set(item.id,{variants:response.variants||[]});
   }catch(error){hlsQualityList.set(item.id,{error:error.message});}
   render();
  };
  panel.append(load);
 }
 return panel;
}

function canExtractAudio(item){
 return canExtractAudioFromVideo(tabUrl,item);
}
function buildAudioPanel(item,isRunning){
 const panel=node('div','audio-extract-panel');
 const title=node('div','section-title','♫ Baixar apenas áudio');
 panel.append(title);
 const picker=document.createElement('select');picker.className='quality-select';
 picker.setAttribute('aria-label','Formato e qualidade do áudio');
 for(const {value,label} of AUDIO_PROFILES){
  const opt=document.createElement('option');opt.value=value;opt.textContent=label;
  picker.append(opt);
 }
 picker.value=chosenAudioProfile.get(item.id)||'mp3-192';
 picker.onchange=()=>chosenAudioProfile.set(item.id,picker.value);
 panel.append(picker);

 const player=item.type==='Player';
 const directPage=player?(canonicalMediaPageUrl(item.pageUrl)||canonicalMediaPageUrl(tabUrl)):null;
 const isExpired=item.type==='HLS'&&hlsExpired(item);
 const button=node('button','download-btn audio-download',
   isRunning?'Processando áudio...':'Extrair e baixar áudio');
 button.disabled=isRunning||isExpired||Boolean(player&&!directPage&&!canonicalMediaPageUrl(pastedPostUrls.get(item.id)||''));
 if(player&&!directPage){
  const input=document.createElement('input');
  input.type='url';input.className='manual-post-input';
  input.placeholder=/pinterest\.com/i.test(tabUrl)?
   'https://www.pinterest.com/pin/123456789/':
   'Cole o link da publicação ou do vídeo';
  input.setAttribute('aria-label','Endereço da publicação para extrair áudio');
  input.value=pastedPostUrls.get(item.id)||'';
  input.oninput=()=>{
   pastedPostUrls.set(item.id,input.value.trim());
   button.disabled=isRunning||!canonicalMediaPageUrl(input.value.trim());
  };
  panel.append(input);
 }
 if(player){
  const selector=document.createElement('select');selector.className='session-select';
  selector.setAttribute('aria-label','Sessão para baixar áudio');
  for(const [value,label] of [['','Sem sessão (público)'],
    ['brave','Usar sessão do Brave'],['firefox','Usar sessão do Firefox']]){
   const opt=document.createElement('option');opt.value=value;opt.textContent=label;selector.append(opt);
  }
  selector.value=sessionChoices.get(item.id)||'';
  selector.onchange=()=>{
   if(selector.value)sessionChoices.set(item.id,selector.value);
   else sessionChoices.delete(item.id);
  };
  panel.append(selector);
 }
 button.onclick=async()=>{
  button.disabled=true;button.textContent='Conectando ao assistente...';notify('');
  const cmd=player?'startNativeAudio':'startNativeSourceAudio';
  try{
   const answer=await chrome.runtime.sendMessage({
    cmd,tabId,id:item.id,audioProfile:picker.value,
    ...(player?{manualUrl:pastedPostUrls.get(item.id)||null,
      cookiesBrowser:sessionChoices.get(item.id)||null}:{})
   });
   if(!answer?.ok)throw new Error(answer?.error||'O assistente não iniciou a extração de áudio.');
  }catch(error){notify(error.message);}
  await load();
 };
 panel.append(button);
 panel.append(node('div','notice',isExpired?
  'Playlist expirada: atualize a página antes de extrair áudio.':
  'A extração utiliza FFmpeg; a qualidade final depende do áudio original. Arquivos privados ou protegidos podem não estar disponíveis.'));
 return panel;
}

function imageOutputFor(item){
 return imageOutputSelection.get(item.id)||imageOutputDefault;
}
function imageQualityFor(item){
 return imageQualitySelection.get(item.id)||imageQualityDefault;
}
function imageFormatPanel(item){
 const wrap=node('div','image-format-panel');
 const title=node('label','quality-label','Formato para salvar a imagem');
 const select=document.createElement('select');select.className='quality-select';
 select.setAttribute('aria-label','Formato de saída da imagem');
 const source=fileExtension(item)?.toUpperCase()||'original';
 const values=[['original','Original ('+source+') — sem conversão'],
  ['png','PNG · sem perdas, mantém transparência'],
  ['jpg','JPG · arquivo compacto, fundo branco'],
  ['webp','WebP · compacto, mantém transparência']];
 for(const [value,description] of values){
  const option=document.createElement('option');option.value=value;option.textContent=description;
  select.append(option);
 }
 select.value=imageOutputFor(item);
 select.onchange=()=>{
  imageOutputSelection.set(item.id,select.value);
  imageOutputDefault=select.value;
  chrome.storage.local.set({imageOutputPreference:select.value}).catch(()=>{});
  render();
 };
 title.append(select);wrap.append(title);
 const format=imageOutputFor(item);
 if(format==='jpg'||format==='webp'){
  const qualityLabel=node('label','quality-label','Qualidade de compressão');
  const quality=document.createElement('select');quality.className='quality-select';
  for(const [value,description] of [['0.92','Alta · 92%'],['0.85','Equilibrada · 85%'],
   ['0.7','Compacta · 70%'],['1','Máxima · 100%']]){
   const option=document.createElement('option');option.value=value;option.textContent=description;
   quality.append(option);
  }
  quality.value=String(imageQualityFor(item));
  quality.onchange=()=>{
   imageQualitySelection.set(item.id,Number(quality.value));
   imageQualityDefault=Number(quality.value);
   chrome.storage.local.set({imageQualityPreference:Number(quality.value)}).catch(()=>{});
  };
  qualityLabel.append(quality);wrap.append(qualityLabel);
 }
 wrap.append(node('div','notice',format==='original'?
  'Baixa a imagem exatamente como fornecida pelo site.':
  format==='jpg'?
  'Conversão local: áreas transparentes recebem fundo branco. Não aumenta a resolução da imagem.':
  'Conversão local no navegador, sem enviar para serviços externos. Animações permanecem no formato original.'));
 return wrap;
}
function mediaCard(item,index,{uncertain=false,audioOnly=false}={}){
 const kind=group(item.type);
 const card=node('article','media-card');
 const line=node('div','media-line');
 const main=node('div','media-main');
 const head=node('div','media-title',label(item,index));head.title=head.textContent;
 const chips=node('div','media-sub');
 const ext=fileExtension(item);
 chips.append(node('span','chip primary',item.type==='Player'?'PLAYER':item.type==='HLS'?'HLS':item.type==='DASH'?'DASH':(ext||'Arquivo').toUpperCase()));
 if(item.type==='Player'){
  chips.append(node('span','chip verified',audioOnly?'Áudio extraível':'Vídeo identificado'));
  if(item.engine)chips.append(node('span','chip',item.engine));
  if(item.trackVideo)chips.append(node('span','chip',item.trackVideo+' faixas de vídeo'));
  if(item.trackAudio)chips.append(node('span','chip',item.trackAudio+' faixas de áudio'));
 }
 if(item.sourceKind==='progressive')chips.append(node('span','chip verified','Áudio + vídeo'));
 if(item.requestKind==='media'&&item.responseStatus>=200&&item.responseStatus<300)
  chips.append(node('span','chip verified','Requisição do player'));
 if(item.width&&item.height)chips.append(node('span','chip',`${item.width}×${item.height}`));
 if(item.duration)chips.append(node('span','chip',timeLabel(item.duration)));
 if(item.source==='page'&&item.visible)chips.append(node('span','chip','Na página'));
 if(item.type==='Video'||item.type==='Audio'||item.type==='Image'){
  const analysis=item.analysis;
  if(analysis?.state==='likely')chips.append(node('span','chip verified','Download provável'));
  else if(analysis?.state==='partial')chips.append(node('span','chip warning','Arquivo parcial'));
  else if(item.status==='blocked'&&/403|autoriza|acesso|bloquead/i.test(item.message||''))chips.append(node('span','chip warning','Acesso bloqueado'));
  else if(item.status==='blocked')chips.append(node('span','chip warning','Indisponível'));
  else if(analysis?.state==='unavailable')chips.append(node('span','chip warning','Acesso negado'));
  else if(analysis?.state==='uncertain')chips.append(node('span','chip warning','Não confirmado'));
  else if(item.responseStatus===206)chips.append(node('span','chip warning','Resposta 206'));
  else chips.append(node('span','chip','A verificar'));
 }
 const host=node('div','media-host',hostName(item));
 if(item.responseStatus===403)host.title='HTTP 403: servidor bloqueou o acesso à fonte.';
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
 const audioCapable=canExtractAudio(item);
 if(!audioOnly){
 const actions=node('div','media-actions');
 const isRunning=['checking','running','saving','downloading','native-connecting','native-running'].includes(item.status);
 const blocked=item.type==='Player'||item.status==='blocked'||(item.analysis&&!item.analysis.canDownload);
 const method=preferredDownloadMethod(tabUrl,item);
 const nativeHls=item.type==='HLS'&&method==='native';
 const expiredHls=item.type==='HLS'&&method==='expired';
 const inaccessibleHls=item.type==='HLS'&&(/HTTP 40[13]/i.test(item.message||'')||expiredHls);
 const browserHlsDenied=item.type==='HLS'&&/HTTP 40[13].*(playlist|segmento)/i.test(item.message||'');
 const candidates=item.type==='Player'?possibleSources(item):[];
 const button=node('button','download-btn',isRunning?'Verificando / baixando...':blocked?'Verificar novamente':item.status==='done'?'Baixar novamente':
  (item.type==='HLS'?'Baixar stream':item.analysis?.canDownload?`Baixar ${names[kind]?.toLowerCase()||'arquivo'}`:'Verificar e baixar'));
 const formatMissing=!['HLS','DASH','Player'].includes(item.type)&&!ext;
 if(item.type==='Player')button.textContent=candidates.length?
  `Buscar fontes de download (${candidates.length})`:'Procurar fonte do vídeo';
 if(item.type==='DASH')button.textContent='DASH indisponível';
 if(inaccessibleHls)button.textContent=expiredHls?'Playlist expirada — recarregue o episódio':'Playlist recusada — consulte a origem';
 if(nativeHls)button.textContent=isRunning?'Baixando com assistente local...':'Baixar com assistente local';
 if(formatMissing)button.textContent='Formato indisponível';
 if(item.type==='Image'){
  const output=imageOutputFor(item);
  button.textContent=isRunning?'Processando imagem...':
   output==='original'?'Baixar imagem original':'Converter e baixar '+output.toUpperCase();
 }
 button.disabled=isRunning||expiredHls||(inaccessibleHls&&!nativeHls)||item.type==='DASH'||(formatMissing&&item.type!=='Player');
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
   const imageConvert=item.type==='Image'&&imageOutputFor(item)!=='original';
   const cmd=imageConvert?'startImageConversion':
    nativeHls?'startNativeSource':blocked?'verifyMedia':'startDownload';
   const result=await chrome.runtime.sendMessage({cmd,tabId,id:item.id,force:blocked,
    format:imageConvert?imageOutputFor(item):undefined,
    quality:imageConvert?imageQualityFor(item):(chosenNativeQuality.get(item.id)||'best'),
    selectedUrl:!nativeHls?(hlsSelectedVariant.get(item.id)||null):null});
   if(!result?.ok)throw new Error(result?.error||'Não foi possível verificar o arquivo.');
   if(cmd==='verifyMedia'&&result.analysis?.canDownload)notify('Fonte aprovada na verificação. Clique em Baixar para continuar.');
   await load();
  }catch(error){notify(error.message);await load();}
 };
 actions.append(button);
 if(item.type==='Image')card.append(imageFormatPanel(item));
 if(item.type==='HLS'&&!nativeHls&&!expiredHls)card.append(hlsQualitySelector(item));
 if(nativeHls)card.append(nativeQualitySelector(item));
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
 if(contextualSourceAvailable(item)){
  if(item.type==='HLS'){
   card.append(node('div','notice',expiredHls?
    'Esta URL HLS temporária expirou. Atualize o episódio para buscar uma playlist nova.':
    browserHlsDenied?
    'A solicitação feita fora do player foi recusada. O botão principal agora tenta o método local com a origem autorizada da página. O servidor ainda pode negar acesso.':
    'Para este servidor, o método local é priorizado porque o acesso direto à playlist pode ser recusado.'));
  }else{
  const contextual=node('div','media-actions');
  const expired=hlsExpired(item);
  const viaSite=node('button','download-btn local-download',
    isRunning?'Processando pelo assistente local...':
    expired?'Link temporário expirado':
    item.type==='HLS'?'Tentar playlist via assistente local':'Tentar download pela página de origem');
  viaSite.disabled=isRunning||expired;
  viaSite.onclick=async()=>{
   viaSite.disabled=true;viaSite.textContent='Conectando...';notify('');
   try{
    const res=await chrome.runtime.sendMessage({cmd:'startNativeSource',tabId,id:item.id});
    if(!res?.ok)throw new Error(res?.error||'Não foi possível usar o assistente.');
   }catch(e){notify(e.message);}
   await load();
  };
  contextual.append(viaSite);card.append(contextual);
  card.append(node('div','notice',expired?
   'A playlist possui um token expirado. Recarregue o episódio no site antes de tentar novamente.':
   'Alternativa manual usando a referência da página onde o vídeo foi reproduzido. Se o CDN recusar, o assistente encerrará a tentativa e explicará o erro.'));
  }
 }
 if(item.type==='Player' && (/instagram\.com|youtube\.com|youtu\.be|pinterest\.com/.test(tabUrl))){
  const isPinterest=/pinterest\.com/.test(tabUrl);
  const directPage=canonicalMediaPageUrl(item.pageUrl)||canonicalMediaPageUrl(tabUrl);
  const priorPasted=pastedPostUrls.get(item.id)||'';
  const nativeControls=node('div','media-actions native-actions');
  const nativeButton=node('button','download-btn local-download',isRunning?'Processando com assistente...':
   directPage?'Baixar publicação com assistente local':
   canonicalMediaPageUrl(priorPasted)?'Baixar link informado':'Informe o link da publicação');
  nativeButton.disabled=isRunning||!(directPage||canonicalMediaPageUrl(priorPasted));
  nativeButton.onclick=async()=>{
   nativeButton.disabled=true;nativeButton.textContent='Conectando...';notify('');
   try{
    const answer=await chrome.runtime.sendMessage({cmd:'startNativeDownload',tabId,id:item.id,
     manualUrl:pastedPostUrls.get(item.id)||null,
     cookiesBrowser:sessionChoices.get(item.id)||null,
     quality:chosenNativeQuality.get(item.id)||'best'});
    if(!answer?.ok)throw new Error(answer?.error||'Não foi possível conectar ao assistente.');
   }catch(error){notify(error.message);}
   await load();
  };
  const help=node('button','cancel-btn','Configurar');
  help.title='Instruções de instalação do assistente local no Chrome ou Brave';
  help.onclick=()=>chrome.tabs.create({url:'https://github.com/kardecallan566/media_dowloader/blob/main/native/README.md'});
  nativeControls.append(nativeButton,help);
  card.append(nativeQualitySelector(item),nativeControls);
  if(!directPage){
   const entry=node('div','manual-post');
   entry.append(node('div','section-title',isPinterest?'Link do Pin com vídeo':'Link do Reel ou post'));
   const input=document.createElement('input');
   input.type='url';input.className='manual-post-input';
   input.placeholder=isPinterest?'https://www.pinterest.com/pin/123456789/':'https://www.instagram.com/reel/.../';
   input.setAttribute('aria-label','Link específico da publicação');
   input.value=priorPasted;
   input.oninput=()=>{
    pastedPostUrls.set(item.id,input.value.trim());
    const valid=canonicalMediaPageUrl(input.value.trim());
    nativeButton.disabled=isRunning||!valid;
    nativeButton.textContent=valid?'Baixar link informado':'Informe o link da publicação';
   };
   entry.append(input);
   card.append(entry);
  }
  if(directPage)card.append(node('div','notice','Publicação identificada: '+directPage));
  else card.append(node('div','notice',isPinterest?
   'Abra o Pin de vídeo e copie seu link /pin/número/. Não escolha aleatoriamente uma das playlists pré-carregadas no feed.':
   'No feed, use Compartilhar → Copiar link no vídeo desejado e cole acima. Não será escolhido outro vídeo automaticamente.'));
  const authArea=node('div','session-choice');
  const title=node('label','session-label','Autenticação (opcional)');
  const selector=document.createElement('select');
  selector.className='session-select';
  const options=[
   ['', 'Sem sessão — recomendado para vídeos públicos'],
   ['brave','Tentar sessão do Brave'],
   ['firefox','Tentar sessão do Firefox (se instalado e conectado)']
  ];
  for(const [value,label] of options){
   const option=document.createElement('option');option.value=value;option.textContent=label;selector.append(option);
  }
  selector.value=sessionChoices.get(item.id)||'';
  selector.onchange=()=>{
   if(selector.value)sessionChoices.set(item.id,selector.value);
   else sessionChoices.delete(item.id);
  };
  authArea.append(title,selector,
    node('div','notice','O assistente só tenta ler os cookies quando você escolhe um navegador. Se a leitura falhar, ele tentará o link público automaticamente.'));
  card.append(authArea);
  card.append(node('div','notice','O assistente é opcional e não remove DRM. Ele baixa somente mídia acessível e pode exigir acesso autorizado.'));
 }
 }
 if(audioCapable)card.append(buildAudioPanel(item,
  ['checking','running','saving','downloading','native-connecting','native-running'].includes(item.status)));
 const detail=document.createElement('details');
 const summary=document.createElement('summary');summary.textContent=uncertain?'Ver origem da fonte':'Detalhes técnicos';
 const url=node('div','raw-url',item.url);
 detail.append(summary,url);
 if(item.requestKind)detail.append(node('div','raw-url',
  'Tipo da requisição: '+item.requestKind+' · HTTP '+(item.responseStatus||'?')));
 if(item.requestOrigin)detail.append(node('div','raw-url','Origem observada: '+item.requestOrigin));
 card.append(detail);
 if(!audioOnly&&item.type==='Player'&&playerSourcesOpen.has(item.id)){
  const panel=node('div','player-candidates');
  const all=possibleSources(item);
  panel.append(node('div','section-title',all.length?
   'Possíveis fontes encontradas':'Nenhum arquivo completo identificado ainda'));
  const pinterestPanel=/pinterest\.com/.test(tabUrl);
  panel.append(node('div','notice',all.length?
   (pinterestPanel?
    'Essas fontes HLS podem ser qualidades ou faixas separadas do mesmo vídeo, não downloads completos diferentes. Para vídeo com áudio, abra o Pin específico e use o assistente local.':
    'As fontes vêm de requisições da página e podem ser de outros vídeos do feed. Verifique antes de baixar.'):
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
  const count=items.filter(item=>(group(item.type)===kind||
   (kind==='audio'&&canExtractAudio(item)))&&item.source==='page'&&item.visible).length;
  $(kind+'Count').textContent=count?String(Math.min(99,count)):'';
 }
 const choices=sortMedia(items.filter(item=>group(item.type)===active||
  (active==='audio'&&canExtractAudio(item))));
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
 focus.forEach((item,index)=>main.append(mediaCard(item,index,{
  uncertain:item.source!=='page',audioOnly:active==='audio'&&item.type!=='Audio'
 })));
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
   extra.slice(0,moreLimit).forEach((item,index)=>extraList.append(mediaCard(item,index+focus.length,{
    uncertain:true,audioOnly:active==='audio'&&item.type!=='Audio'
   })));
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

let playlistJob=null;
let playlistDraftTimer=null;
let playlistPreviousFocus=null;
const playlistEls={
 tool:$('playlistTool'),toggle:$('playlistToggle'),close:$('playlistClose'),
 backdrop:$('playlistBackdrop'),url:$('playlistUrl'),format:$('playlistFormat'),
 cookies:$('playlistCookies'),start:$('playlistStart'),
 cancel:$('playlistCancel'),status:$('playlistStatus'),progress:$('playlistProgress')
};
function openPlaylistPanel(){
 if(!playlistEls.tool.hidden)return;
 playlistPreviousFocus=document.activeElement;
 playlistEls.tool.hidden=false;
 playlistEls.backdrop.hidden=false;
 playlistEls.toggle.setAttribute('aria-expanded','true');
 (youtubePlaylistUrl(playlistEls.url.value)?playlistEls.start:playlistEls.url).focus();
}
function closePlaylistPanel(){
 if(playlistEls.tool.hidden)return;
 playlistEls.tool.hidden=true;
 playlistEls.backdrop.hidden=true;
 playlistEls.toggle.setAttribute('aria-expanded','false');
 const target=playlistPreviousFocus?.isConnected?playlistPreviousFocus:playlistEls.toggle;
 target.focus();
 playlistPreviousFocus=null;
}
playlistEls.toggle.onclick=()=>playlistEls.tool.hidden?openPlaylistPanel():closePlaylistPanel();
playlistEls.close.onclick=closePlaylistPanel;
playlistEls.backdrop.onclick=closePlaylistPanel;
document.addEventListener('keydown',event=>{
 if(playlistEls.tool.hidden)return;
 if(event.key==='Escape'){
  event.preventDefault();closePlaylistPanel();return;
 }
 if(event.key!=='Tab')return;
 const focusable=[...playlistEls.tool.querySelectorAll('button,input,select')]
  .filter(element=>!element.disabled&&!element.hidden&&element.getClientRects().length);
 if(!focusable.length){event.preventDefault();playlistEls.tool.focus();return;}
 const first=focusable[0],last=focusable[focusable.length-1];
 if(event.shiftKey&&(document.activeElement===first||document.activeElement===playlistEls.tool)){
  event.preventDefault();last.focus();
 }else if(!event.shiftKey&&(document.activeElement===last||
          !playlistEls.tool.contains(document.activeElement))){
  event.preventDefault();first.focus();
 }
});
function persistPlaylistDraft(){
 clearTimeout(playlistDraftTimer);
 playlistDraftTimer=setTimeout(()=>{
  const url=youtubePlaylistUrl(playlistEls.url.value);
  if(!url)return;
  chrome.storage.local.set({playlistFormDraft:{
   url,format:playlistEls.format.value
  }}).catch(()=>{});
 },180);
}

function renderPlaylistJob(){
 const job=playlistJob;
 const busy=Boolean(job&&['connecting','running','canceling'].includes(job.status));
 const indicator=busy?'running':
  ['error','partial','interrupted'].includes(job?.status)?'warning':
  job?.status==='done'?'done':'';
 if(indicator)playlistEls.toggle.dataset.status=indicator;
 else delete playlistEls.toggle.dataset.status;
 const label=busy?'Playlist em andamento — abrir detalhes':
  indicator==='warning'?'Playlist com pendências — abrir detalhes':
  indicator==='done'?'Playlist concluída — abrir detalhes':
  'Baixar áudios de uma playlist do YouTube';
 playlistEls.toggle.title=label;
 playlistEls.toggle.setAttribute('aria-label',label);
 const valid=Boolean(youtubePlaylistUrl(playlistEls.url.value));
 playlistEls.start.disabled=busy||!valid;
 playlistEls.cancel.disabled=!busy||job.status==='canceling';
 playlistEls.url.disabled=busy;
 playlistEls.format.disabled=busy;
 playlistEls.cookies.disabled=busy;
 playlistEls.start.textContent=busy?'Baixando playlist...':'Baixar todos os áudios';
 if(!job){
  playlistEls.status.textContent=valid?'Pronto para iniciar a playlist.':'Informe um link válido de playlist do YouTube.';
  playlistEls.progress.hidden=true;
  return;
 }
 const done=job.status==='done'||job.status==='partial';
 const prefix=({done:'Concluído',partial:'Concluído com pendências',
  error:'Erro',canceled:'Cancelado',interrupted:'Interrompido',
  canceling:'Cancelando',connecting:'Conectando',running:'Processando'})[job.status]||job.status;
 const parts=[prefix,job.message||''];
 if(job.current)parts.push('Faixa '+job.current+(job.total?' de '+job.total:''));
 if(job.saved||job.previous||job.failed||done)
  parts.push('Novas: '+(job.saved||0)+' · Anteriores: '+(job.previous||0)+' · Falhas: '+(job.failed||0));
 playlistEls.status.textContent=parts.join(' · ');
 playlistEls.progress.hidden=!busy&&!done;
 if(job.total>0){
  playlistEls.progress.value=Math.max(0,Math.min(100,
   done?100:Math.round(((job.current||0)/job.total)*100)));
 }else if(done)playlistEls.progress.value=100;
 else playlistEls.progress.removeAttribute('value');
}
async function refreshPlaylistJob(){
 try{
  const response=await chrome.runtime.sendMessage({cmd:'getPlaylistAudioJob'});
  if(!response?.ok&&response?.error)throw new Error(response.error);
  playlistJob=response?.job||null;
  renderPlaylistJob();
 }catch(error){playlistEls.status.textContent='Não foi possível ler o estado da playlist: '+error.message;}
}
playlistEls.url.oninput=()=>{renderPlaylistJob();persistPlaylistDraft();};
playlistEls.format.onchange=persistPlaylistDraft;
playlistEls.start.onclick=async()=>{
 const url=youtubePlaylistUrl(playlistEls.url.value);
 if(!url){playlistEls.status.textContent='Cole um link válido de playlist.';return;}
 playlistEls.start.disabled=true;
 playlistEls.status.textContent='Iniciando download em lote...';
 try{
  const result=await chrome.runtime.sendMessage({cmd:'startPlaylistAudio',
   url,audioProfile:playlistEls.format.value,
   cookiesBrowser:playlistEls.cookies.value||null});
  if(!result?.ok)throw new Error(result?.error||'Não foi possível iniciar a playlist.');
  persistPlaylistDraft();
 }catch(error){playlistEls.status.textContent=error.message;}
 await refreshPlaylistJob();
};
playlistEls.cancel.onclick=async()=>{
 playlistEls.cancel.disabled=true;
 try{
  const result=await chrome.runtime.sendMessage({cmd:'cancelPlaylistAudio'});
  if(!result?.ok)throw new Error(result?.error||'Não foi possível cancelar.');
 }catch(error){playlistEls.status.textContent=error.message;}
 await refreshPlaylistJob();
};

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
 if(area==='local'&&changes.playlistAudioJob){
  playlistJob=changes.playlistAudioJob.newValue||null;
  renderPlaylistJob();
 }
});
(async()=>{
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id)throw new Error('Não foi possível identificar a aba atual.');
  tabId=tab.id;tabUrl=tab.url||'';
  const activePlaylist=youtubePlaylistUrl(tabUrl);
  const {playlistFormDraft={},imageOutputPreference='original',imageQualityPreference=0.92}=
   await chrome.storage.local.get(['playlistFormDraft','imageOutputPreference','imageQualityPreference']);
  if(['original','png','jpg','webp'].includes(imageOutputPreference))
   imageOutputDefault=imageOutputPreference;
  if([0.7,0.85,0.92,1].includes(imageQualityPreference))
   imageQualityDefault=imageQualityPreference;
  if(activePlaylist)playlistEls.url.value=activePlaylist;
  else if(youtubePlaylistUrl(playlistFormDraft.url||'')){
   playlistEls.url.value=playlistFormDraft.url;
  }
  if(['mp3-128','mp3-192','mp3-320','m4a','opus'].includes(playlistFormDraft.format))
   playlistEls.format.value=playlistFormDraft.format;
  await refreshPlaylistJob();
  if(!playlistEls.url.value&&youtubePlaylistUrl(playlistJob?.url||''))
   playlistEls.url.value=playlistJob.url;
  renderPlaylistJob();
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
