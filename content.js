// Detect media that belongs to the visible page, instead of presenting every CDN request.
(()=>{
 const observed=new Map();
 let timer=null;
 const asUrl=(raw)=>{
  try {const u=new URL(raw,location.href);return ['http:','https:'].includes(u.protocol)?u.href:null;}
  catch{return null;}
 };
 const asMedia=(raw,mime='')=>{
  const url=asUrl(raw);
  if(!url)return null;
  const path=new URL(url).pathname.toLowerCase();
  if(/\.(m3u8|mpd|mp4|webm|mov|m4v|ogv|mp3|m4a|aac|ogg|wav|flac|opus|jpe?g|png|webp|gif|avif|bmp)$/.test(path)||/^(video|audio|image)\//.test(mime))return url;
  return null;
 };
 function inView(node){
  const r=node.getBoundingClientRect();
  return r.width>90 && r.height>80 && r.bottom>=-80 && r.top<=innerHeight+80 &&
   r.right>=0 && r.left<=innerWidth;
 }
 function description(node){
  return (node.getAttribute('alt')||node.getAttribute('aria-label')||
   node.closest('figure,article')?.getAttribute('aria-label')||'').trim().slice(0,100);
 }
 function add(result,raw,opts={}){
  const url=asMedia(raw,opts.contentType||'');
  if(!url)return;
  const key=url;
  const old=result.get(key);
  if(!old||(!old.visible&&opts.visible))result.set(key,{url, ...opts});
 }
 function scan(force=false){
  const candidates=new Map();
  const metaPoster=document.querySelector('meta[property="og:image"],meta[name="twitter:image"]')?.content||'';
  const fallbackPoster=asUrl(metaPoster);
  for(const video of document.querySelectorAll('video,audio')){
   if(!inView(video))continue;
   const mime=video.tagName==='AUDIO'?'audio/mp3':'video/mp4';
   const thumb=video.poster||fallbackPoster;
   const attrs={visible:true,label:description(video),thumbnail:asUrl(thumb),
    duration:Number.isFinite(video.duration)?Math.round(video.duration):null,
    width:video.videoWidth||null,height:video.videoHeight||null};
   // Don't invent the MIME of a URL with an unknown extension.
   add(candidates,video.currentSrc,attrs);
   add(candidates,video.getAttribute('src'),attrs);
   for(const source of video.querySelectorAll('source')){
    add(candidates,source.getAttribute('src'),{...attrs,contentType:source.type||''});
   }
  }
  for(const image of document.querySelectorAll('img')){
   if(!inView(image))continue;
   const r=image.getBoundingClientRect();
   if((image.naturalWidth||r.width)<220||(image.naturalHeight||r.height)<160)continue;
   add(candidates,image.currentSrc||image.getAttribute('src'),{
    visible:true,label:description(image),
    width:image.naturalWidth||Math.round(r.width),height:image.naturalHeight||Math.round(r.height)
   });
  }
  // Metadata identifies the page's main media even when the player has not started.
  const selectors=[
   ['meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[name="twitter:player:stream"]','video/mp4'],
   ['meta[property="og:audio"],meta[property="og:audio:secure_url"]','audio/mpeg'],
   ['meta[property="og:image"],meta[name="twitter:image"]','image/jpeg']
  ];
  for(const [selector,mime] of selectors){
   const node=document.querySelector(selector);
   if(node?.content)add(candidates,node.content,{visible:false,contentType:mime,label:document.title});
  }
  // Do not enumerate every off-screen image/link in the infinite Instagram feed.
  const next=[...candidates.values()].slice(0,35);
  const signature=JSON.stringify(next.map(i=>[i.url,i.visible,i.label]));
  if(!force&&observed.get('snapshot')===signature)return;
  observed.set('snapshot',signature);
  chrome.runtime.sendMessage({cmd:'mediaSnapshot',items:next}).catch(()=>{});
 }
 function schedule(force=false){
  clearTimeout(timer);timer=setTimeout(()=>scan(force),180);
 }
 const mutation=new MutationObserver(()=>schedule());
 mutation.observe(document.documentElement,{subtree:true,childList:true,attributes:true,
  attributeFilter:['src','srcset','poster','content','style','class']});
 addEventListener('scroll',()=>schedule(),{passive:true});
 addEventListener('resize',()=>schedule(),{passive:true});
 document.addEventListener('load',event=>{
  if(event.target instanceof HTMLImageElement||event.target instanceof HTMLVideoElement)schedule();
 },true);
 document.addEventListener('loadedmetadata',()=>schedule(),true);
 chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg?.cmd==='rescanMedia'){schedule(true);sendResponse({ok:true});}
 });
 scan(true);
})();
