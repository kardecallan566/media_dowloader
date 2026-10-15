// Read-only YouTube player discovery. Runs in MAIN world so ytInitialPlayerResponse is accessible.
// No signature deciphering, playback interception, access-control bypass or media recording.
(() => {
 const kind='MF_YOUTUBE_PLAYER_V1';
 let last='', timer=null;
 function locateResponse(){
  const candidates=[
   window.ytInitialPlayerResponse,
   window.ytplayer?.config?.args?.player_response,
   window.ytplayer?.config?.args?.raw_player_response
  ];
  for(let candidate of candidates){
   if(typeof candidate==='string')try{candidate=JSON.parse(candidate);}catch{continue;}
   if(candidate&&typeof candidate==='object'&&candidate.videoDetails?.videoId)return candidate;
  }
  return null;
 }
 function discover(){
  if(!['/watch','/live'].includes(location.pathname)&&!location.pathname.startsWith('/shorts/')&&
     !location.pathname.startsWith('/embed/'))return;
  const info=locateResponse();
  const details=info?.videoDetails||{};
  const queryId=new URLSearchParams(location.search).get('v')||location.pathname.split('/')[2]||'';
  const videoId=String(details.videoId||queryId).slice(0,40);
  if(!/^[\w-]{11}$/.test(videoId))return;
  // On SPA navigation the global response can lag behind location.
  if(queryId&&/^[\w-]{11}$/.test(queryId)&&videoId!==queryId)return;
  const streaming=info?.streamingData||{};
  const progressive=(streaming.formats||[])
   .filter(f=>typeof f.url==='string'&&f.url.startsWith('https://')&&/^video\//.test(f.mimeType||''))
   .map(f=>({
    url:f.url,mimeType:String(f.mimeType||'').split(';')[0],
    quality:String(f.qualityLabel||f.quality||'').slice(0,40),
    hasAudio:Boolean(f.audioQuality||f.audioChannels)
   }))
   .filter(f=>{try{return new URL(f.url).hostname.endsWith('.googlevideo.com');}catch{return false;}})
   .slice(0,6);
  const audioTracks=(streaming.adaptiveFormats||[]).filter(f=>String(f.mimeType).startsWith('audio/')).length;
  const videoTracks=(streaming.adaptiveFormats||[]).filter(f=>String(f.mimeType).startsWith('video/')).length;
  const title=String(details.title||document.title||'Vídeo do YouTube').slice(0,160);
  const seconds=Number(details.lengthSeconds)||null;
  const state={videoId,title,seconds,progressive,audioTracks,videoTracks,
   thumbnail:'https://i.ytimg.com/vi/'+videoId+'/hqdefault.jpg'};
  // Send on navigation or changed streaming data, never repeatedly flood the extension.
  const signature=JSON.stringify(state);
  if(signature===last)return;
  last=signature;
  window.postMessage({kind,payload:state},location.origin);
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(discover,350);}
 window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||
     event.data?.kind!=='MF_YOUTUBE_REFRESH_V1')return;
  last='';
  schedule();
 });
 document.addEventListener('yt-navigate-finish',schedule);
 window.addEventListener('popstate',schedule);
 document.addEventListener('loadedmetadata',schedule,true);
 setInterval(discover,4500);
 discover();
})();
