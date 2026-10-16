// Only a specific video/post URL should be passed to the native downloader.
// A feed, home page, search page or profile is NOT an unambiguous video.
export function canonicalMediaPageUrl(raw) {
 let url;
 try { url=new URL(raw); } catch { return null; }
 if(url.protocol!=='https:' || url.username || url.password || url.port) return null;
 const host=url.hostname.toLowerCase(),segments=url.pathname.split('/').filter(Boolean);
 if(host==='instagram.com'||host==='www.instagram.com'){
  if(segments.length===2 && ['reel','p','tv'].includes(segments[0]) &&
      /^[A-Za-z0-9_-]{5,40}$/.test(segments[1]))
   return 'https://www.instagram.com/'+segments.join('/')+'/';
  return null;
 }
 if(host==='youtube.com'||host==='www.youtube.com'||host==='m.youtube.com'){
  let id=null;
  if(segments.length===1&&segments[0]==='watch')id=url.searchParams.get('v');
  else if(segments.length===2&&['shorts','live','embed'].includes(segments[0]))id=segments[1];
  return id&&/^[\w-]{11}$/.test(id)?'https://www.youtube.com/watch?v='+id:null;
 }
 if(host==='youtu.be'&&segments.length===1&&/^[\w-]{11}$/.test(segments[0]))
  return 'https://www.youtube.com/watch?v='+segments[0];
 return null;
}
export function uniquePostUrl(candidates) {
 const urls=[...new Set(candidates.map(canonicalMediaPageUrl).filter(Boolean))];
 return urls.length===1?urls[0]:null;
}
