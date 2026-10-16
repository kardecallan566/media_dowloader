// Strict, bounded byte-range downloads for servers exposing one complete progressive resource.
// HTTP byte ranges are not interchangeable with HLS/DASH fragment URLs.
import { parseRange, validateCompleteVideo } from './download-check.js';

const MAX_BYTES=96*1024*1024;
export const RANGE_MAX_BYTES=MAX_BYTES;
const CHUNK_SIZE=1024*1024;

function header(response,key){return response.headers.get(key);}
function totalFrom(response){
 const r=parseRange(header(response,'content-range'));
 return r?.total??null;
}
export function evaluateRangedPreview(status,headers,bytes,type,ext) {
 const range=parseRange(headers.get('content-range'));
 const mime=(headers.get('content-type')||'').toLowerCase();
 if(status!==206||!range||range.start!==0||range.total===null||
    range.total<65536||range.total>MAX_BYTES)
  return {state:'blocked',canDownload:false,reason:'Este servidor não expõe intervalos de um único arquivo completo dentro do limite de 96 MB.'};
 if(type!=='Video'||!['mp4','webm'].includes(ext))
  return {state:'blocked',canDownload:false,reason:'Montagem por intervalos está disponível somente para MP4/WebM progressivo.'};
 if(!mime.startsWith('video/'))
  return {state:'blocked',canDownload:false,reason:'O servidor não identificou o recurso como vídeo.'};
 const mp4=bytes.length>=12 && String.fromCharCode(...bytes.subarray(4,8))==='ftyp';
 const webm=bytes.length>=4&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
 const valid=ext==='mp4'?mp4:webm;
 if(!valid)return {state:'blocked',canDownload:false,reason:'O primeiro intervalo não contém o cabeçalho de um arquivo de vídeo independente.'};
 return {state:'range',canDownload:true,size:range.total,checkedBytes:bytes.length,
  reason:'Arquivo progressivo acessível por intervalos; serão baixados e verificados todos os bytes.'};
}
export async function downloadRanges(url,total,{fetcher=fetch,signal,onProgress=()=>{},chunkSize=CHUNK_SIZE,concurrency=3}={}){
 if(!Number.isSafeInteger(total)||total<65536||total>MAX_BYTES)
  throw new Error('Tamanho fora do limite de montagem segura (96 MB).');
 if(!Number.isInteger(chunkSize)||chunkSize<16384||chunkSize>4*1024*1024)
  throw new Error('Bloco inválido.');
 const parts=Math.ceil(total/chunkSize);
 const chunks=new Array(parts);
 let cursor=0,downloaded=0;
 const workers=Array.from({length:Math.min(concurrency,parts)},async()=>{
  while(cursor<parts){
   if(signal?.aborted)throw new Error('Download cancelado.');
   const index=cursor++,start=index*chunkSize,end=Math.min(total-1,start+chunkSize-1);
   let last;
   for(let attempt=0;attempt<3;attempt++){
    try{
     const response=await fetcher(url,{method:'GET',credentials:'include',cache:'no-store',
      headers:{Range:`bytes=${start}-${end}`},signal});
     const range=parseRange(header(response,'content-range'));
     if(response.status!==206||!range||range.start!==start||range.end!==end||range.total!==total)
      throw new Error(`Resposta por intervalos incompatível no trecho ${index+1} (${response.status}).`);
     const data=new Uint8Array(await response.arrayBuffer());
     if(data.byteLength!==end-start+1)
      throw new Error(`Trecho ${index+1} incompleto: ${data.byteLength} bytes.`);
     chunks[index]=data;downloaded+=data.length;
     onProgress({bytes:downloaded,total,partsDone:chunks.filter(Boolean).length,parts});
     last=null;break;
    }catch(error){last=error;if(signal?.aborted)throw error;}
   }
   if(last)throw last;
  }
 });
 await Promise.all(workers);
 if(signal?.aborted)throw new Error('Download cancelado.');
 if(downloaded!==total||chunks.some(x=>!x))throw new Error('Arquivo incompleto: nem todos os intervalos foram obtidos.');
 const result=new Uint8Array(total);
 let offset=0;for(const part of chunks){result.set(part,offset);offset+=part.length;}
 return result;
}
export function verifyReconstructedVideo(bytes,ext) {
 const result=validateCompleteVideo(bytes,ext);
 if(!result.ok)throw new Error(result.reason||'Arquivo não contém vídeo completo.');
 return true;
}
