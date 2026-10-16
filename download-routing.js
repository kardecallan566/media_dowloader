// Pure policy for choosing a safe download path; no DRM or access-control workarounds.
const CONTEXTUAL_SOURCES=Object.freeze({
  'sushianimes.com.br':Object.freeze({host:'cdn-s01.pixel-sus-4k-image.com',types:['Video'],extensions:['mp4','webm']}),
  'topanimes.net':Object.freeze({host:'doce-de-leite-vegano.b-cdn.net',types:['HLS'],extensions:['m3u8']})
});
export function contextualSource(pageUrl,sourceUrl,type){
 try{
  const page=new URL(pageUrl),source=new URL(sourceUrl);
  if(page.protocol!=='https:'||source.protocol!=='https:'||
    page.username||page.password||source.username||source.password||
    page.port||source.port)return null;
  const pageHost=page.hostname.replace(/^www\./,'');
  const rule=CONTEXTUAL_SOURCES[pageHost];
  if(!rule||source.hostname!==rule.host||!rule.types.includes(type))return null;
  const ext=(source.pathname.match(/\.([a-z0-9]+)$/i)||[])[1]?.toLowerCase();
  if(!rule.extensions.includes(ext))return null;
  return {pageHost,sourceHost:source.hostname,type,origin:page.origin};
 }catch{return null;}
}
export function signedExpiry(url,now=Date.now()){
 try{
  const raw=new URL(url).searchParams.get('expires');
  if(!raw||!/^(?:\d{10}|\d{13})$/.test(raw))return null;
  const millis=raw.length===10?Number(raw)*1000:Number(raw);
  if(!Number.isSafeInteger(millis))return null;
  return {timestamp:millis,expired:millis<=now+15_000};
 }catch{return null;}
}
export function preferredDownloadMethod(pageUrl,item,now=Date.now()){
 if(item?.type!=='HLS')return 'browser';
 if(signedExpiry(item.url,now)?.expired)return 'expired';
 if(contextualSource(pageUrl,item.url,item.type))return 'native';
 return 'browser';
}
