import {contextualSource} from './download-routing.js';

// The video card must map to an exact, supported post or a known observed media source.
export const AUDIO_PROFILES=Object.freeze([
 {value:'mp3-192',label:'MP3 · 192 kbps (recomendado)'},
 {value:'mp3-128',label:'MP3 · 128 kbps (arquivo menor)'},
 {value:'mp3-320',label:'MP3 · 320 kbps'},
 {value:'m4a',label:'M4A · melhor disponível'},
 {value:'opus',label:'Opus · melhor disponível'}
]);
const SOCIAL_HOSTS=['instagram.com','youtube.com','youtube-nocookie.com','youtu.be','pinterest.com'];
export function canExtractAudioFromVideo(pageUrl,item){
 if(!item||typeof item.url!=='string')return false;
 if(item.type==='Player'){
  try{
   const url=new URL(pageUrl);
   return url.protocol==='https:'&&SOCIAL_HOSTS.some(host=>
    url.hostname===host||url.hostname.endsWith('.'+host));
  }catch{return false;}
 }
 return (item.type==='Video'||item.type==='HLS')&&
  Boolean(contextualSource(pageUrl,item.url,item.type));
}
export function isAudioProfile(profile){
 return AUDIO_PROFILES.some(option=>option.value===profile);
}
