// Accept a YouTube playlist, not an arbitrary video URL, channel or redirect.
export function youtubePlaylistUrl(raw){
 if(typeof raw!=='string'||raw.length>2048)return null;
 try{
  const url=new URL(raw.trim());
  if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  if(!['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname.toLowerCase()))
   return null;
  if(!['/playlist','/watch'].includes(url.pathname))return null;
  if(url.pathname==='/watch'&&!/^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get('v')||''))
   return null;
  const values=url.searchParams.getAll('list');
  if(values.length!==1||!/^[A-Za-z0-9_-]{10,64}$/.test(values[0]))return null;
  return 'https://www.youtube.com/playlist?list='+values[0];
 }catch{return null;}
}
