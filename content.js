// Detect real <video> players (including MSE/blob), direct sources and visible images.
// The presence of a player is NEVER proof that its original media is downloadable.
(() => {
 const playerIds=new WeakMap();
 let nextPlayerId=1, timer=null, lastSnapshot='';
 let youtube=null;
 const hasYouTubeHost=/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(location.hostname);
 function http(raw){
  try{const u=new URL(raw,location.href);return ['http:','https:'].includes(u.protocol)?u.href:null;}
  catch{return null;}
 }
 function mediaUrl(raw,mime=''){
  const url=http(raw);if(!url)return null;
  const path=new URL(url).pathname.toLowerCase();
  if(/\.(m3u8|mpd|mp4|webm|mov|m4v|ogv|mp3|m4a|aac|ogg|wav|flac|opus|jpe?g|png|webp|gif|avif|bmp)$/.test(path))return url;
  // Mime is only trusted when explicitly provided by a <source> element or a structured player format.
  if(/^(video|audio|image)\//.test(mime))return url;
  return null;
 }
 function visible(node){
  const r=node.getBoundingClientRect();
  return r.width>100&&r.height>80&&r.bottom>=-50&&r.top<=innerHeight+50&&
   r.left<innerWidth&&r.right>0;
 }
 function label(node){
  const caption=node.closest('article,figure,[role="article"]')?.querySelector('figcaption,h2,[data-testid="post-caption"]');
  const t=node.getAttribute('aria-label')||caption?.textContent||document.title||'Vídeo da página';
  return t.trim().slice(0,130);
 }
 function key(node){
  if(!playerIds.has(node))playerIds.set(node,String(nextPlayerId++));
  return playerIds.get(node);
 }
 function put(output,raw,attributes={}){
  const url=mediaUrl(raw,attributes.contentType||'');
  if(!url)return false;
  const previous=output.get('url:'+url);
  if(!previous||(!previous.visible&&attributes.visible))output.set('url:'+url,{url,...attributes});
  return true;
 }
 function instagramPostUrl(raw){
  try{
   const u=new URL(raw,location.href);
   if(!['instagram.com','www.instagram.com'].includes(u.hostname)||u.protocol!=='https:')return null;
   const match=u.pathname.match(/^\/(reel|p|tv)\/([A-Za-z0-9_-]{5,40})\/?$/);
   return match?'https://www.instagram.com/'+match[1]+'/'+match[2]+'/':null;
  }catch{return null;}
 }
 function actualVideoPage(video){
  const onPost=instagramPostUrl(location.href);
  if(onPost)return onPost;
  if(!/(^|\.)instagram\.com$/.test(location.hostname))return null;
  // Only links within a single video/post container can identify that video.
  let node=video;
  for(let depth=0;node&&depth<9;node=node.parentElement,depth++){
   const nearestLink=node.closest?.('a[href]');
   if(nearestLink){
    const direct=instagramPostUrl(nearestLink.href);
    if(direct)return direct;
   }
   if(!node.querySelectorAll)continue;
   // Do not assume the first of multiple feed posts is the active player.
   if(node.querySelectorAll('video').length>1)break;
   const links=[...node.querySelectorAll('a[href]')].slice(0,30)
    .map(a=>instagramPostUrl(a.href)).filter(Boolean);
   const distinct=[...new Set(links)];
   if(distinct.length===1)return distinct[0];
   if(distinct.length>1)break;
  }
  return null;
 }
 function player(output,attributes){
  const id=String(attributes.playerId);
  const url=http(location.href);
  if(!url)return;
  output.set('player:'+id,{url,type:'Player',playerId:id,
   visible:true,sourceKind:'player',...attributes});
 }
 function scan(force=false){
  const data=new Map();
  const poster=http(document.querySelector('meta[property="og:image"],meta[name="twitter:image"]')?.content);
  const videos=[...document.querySelectorAll('video,audio')].filter(visible).slice(0,10);
  for(const video of videos){
   const isAudio=video.tagName==='AUDIO',thumb=http(video.poster)||poster;
   const attrs={visible:true,label:label(video),thumbnail:thumb,
    duration:Number.isFinite(video.duration)&&video.duration>0?Math.round(video.duration):null,
    width:video.videoWidth||null,height:video.videoHeight||null};
   let hasDirect=false;
   hasDirect=put(data,video.currentSrc,attrs)||hasDirect;
   hasDirect=put(data,video.getAttribute('src'),attrs)||hasDirect;
   for(const source of video.querySelectorAll('source')){
    hasDirect=put(data,source.getAttribute('src'),{...attrs,contentType:source.type||''})||hasDirect;
   }
   if(!isAudio&&!hasDirect&&!youtube){
    const src=video.currentSrc||video.src||'';
    player(data,{...attrs,pageUrl:actualVideoPage(video),playerId:'dom-'+key(video),engine:src.startsWith('blob:')?'MSE / blob':'player HTML5',
      playback:true,
      note:src.startsWith('blob:')?'Player com fonte blob: o arquivo original não está no atributo src.':
       'Player encontrado, mas não disponibiliza uma URL direta de vídeo.'});
   }
  }
  if(youtube&&hasYouTubeHost){
   const id=youtube.videoId;
   const page=new URL(location.href);
   const current=page.searchParams.get('v')||page.pathname.split('/')[2];
   if(current===id){
    player(data,{playerId:'yt-'+id,pageUrl:'https://www.youtube.com/watch?v='+id,visible:true,label:youtube.title,
     thumbnail:youtube.thumbnail,duration:youtube.seconds,engine:'YouTube adaptive',
     playback:true,trackVideo:youtube.videoTracks,trackAudio:youtube.audioTracks,
     note:'Player identificado. Vídeo e áudio podem usar faixas separadas; somente fontes completas verificadas podem ser baixadas.'});
    for(const format of youtube.progressive){
     if(!format.hasAudio)continue; // Video-only is not a complete audiovisual download.
     put(data,format.url,{visible:true,label:youtube.title+' — '+(format.quality||'MP4'),
      contentType:format.mimeType,thumbnail:youtube.thumbnail,duration:youtube.seconds,
      quality:format.quality,playerId:'yt-'+id,sourceKind:'progressive'});
    }
   }
  }
  // Instagram reels and Shorts may not mount an HTMLVideoElement until playback starts.
  const instagram=/(^|\.)instagram\.com$/.test(location.hostname);
  if(instagram && /^\/reel\/[^/]+/.test(location.pathname) &&
     ![...data.values()].some(x=>x.type==='Player'||x.contentType?.startsWith('video/')||
      /\.(mp4|m4v|webm|mov)(?:[?#]|$)/i.test(x.url||''))){
   player(data,{playerId:'instagram-reel',pageUrl:instagramPostUrl(location.href),
    label:document.title||'Instagram Reel',
    thumbnail:poster,engine:'Instagram Reel',playback:false,
    note:'Página de Reel identificada. O vídeo ainda não revelou sua fonte de download.'});
  }
  for(const image of [...document.querySelectorAll('img')].filter(visible).slice(0,28)){
   const r=image.getBoundingClientRect();
   if((image.naturalWidth||r.width)<220||(image.naturalHeight||r.height)<160)continue;
   put(data,image.currentSrc||image.src,{visible:true,
    label:(image.alt||'Imagem da página').slice(0,100),
    width:image.naturalWidth||Math.round(r.width),height:image.naturalHeight||Math.round(r.height)});
  }
  // Metadata is not proof of a video file: only known direct extensions are admitted here.
  for(const selector of ['meta[property="og:video"]','meta[property="og:video:url"]',
   'meta[property="og:video:secure_url"]','meta[name="twitter:player:stream"]',
   'meta[property="og:audio"]','meta[property="og:image"]']){
   const meta=document.querySelector(selector);
   if(!meta?.content)continue;
   const raw=http(meta.content);
   const hostname=raw?new URL(raw).hostname:'';
   // Some Instagram OpenGraph videos use opaque CDN paths without .mp4.
   // Only treat that CDN metadata as a candidate; the HTTP verifier must still approve it.
   const cdnVideo=selector.includes('og:video')&&
      (hostname.endsWith('.cdninstagram.com')||hostname.endsWith('.fbcdn.net'));
   put(data,raw,{visible:false,label:document.title,contentType:cdnVideo?'video/mp4':''});
  }
  const items=[...data.values()].slice(0,42);
  const signature=JSON.stringify(items.map(x=>[x.url,x.type,x.playerId,x.pageUrl,x.visible,x.engine,x.duration,x.trackVideo,x.trackAudio]));
  if(!force&&signature===lastSnapshot)return;
  lastSnapshot=signature;
  chrome.runtime.sendMessage({cmd:'mediaSnapshot',items}).catch(()=>{});
 }
 function schedule(force=false){clearTimeout(timer);timer=setTimeout(()=>scan(force),220);}
 const changes=new MutationObserver(()=>schedule());
 changes.observe(document.documentElement,{childList:true,subtree:true,attributes:true,
  attributeFilter:['src','srcset','poster','content','class']});
 for(const name of ['scroll','resize','popstate','hashchange'])addEventListener(name,()=>schedule(),{passive:true});
 for(const name of ['load','loadedmetadata','durationchange','play','emptied'])
  document.addEventListener(name,()=>schedule(),true);
 if(hasYouTubeHost){
  addEventListener('message',(event)=>{
   if(event.source!==window||event.origin!==location.origin||
      event.data?.kind!=='MF_YOUTUBE_PLAYER_V1')return;
   const data=event.data.payload;
   if(!data||!/^[\w-]{11}$/.test(data.videoId||''))return;
   const url=new URL(location.href);
   const selected=url.searchParams.get('v')||url.pathname.split('/')[2];
   if(selected!==data.videoId)return;
   const progressive=(Array.isArray(data.progressive)?data.progressive:[]).filter(entry=>{
    try{
     const u=new URL(entry.url);
     return u.protocol==='https:' && (u.hostname==='googlevideo.com'||u.hostname.endsWith('.googlevideo.com'))&&
       /^(video\/mp4|video\/webm)$/.test(entry.mimeType||'');
    }catch{return false;}
   }).slice(0,6).map(entry=>({
    url:entry.url,mimeType:entry.mimeType,quality:String(entry.quality||'').slice(0,35),
    hasAudio:entry.hasAudio===true
   }));
   youtube={videoId:data.videoId,title:String(data.title||'Vídeo do YouTube').slice(0,130),
    thumbnail:http(data.thumbnail),seconds:Number(data.seconds)||null,
    audioTracks:Number(data.audioTracks)||0,videoTracks:Number(data.videoTracks)||0,progressive};
   schedule(true);
  });
  document.addEventListener('yt-navigate-finish',()=>{youtube=null;schedule(true)});
 }
 chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg?.cmd==='rescanMedia'){
   scan(true);
   if(hasYouTubeHost)window.postMessage({kind:'MF_YOUTUBE_REFRESH_V1'},location.origin);
   sendResponse({ok:true});
  }
 });
 scan(true);
 if(hasYouTubeHost)setTimeout(()=>window.postMessage({kind:'MF_YOUTUBE_REFRESH_V1'},location.origin),800);
})();
