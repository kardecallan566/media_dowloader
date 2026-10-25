// Image transcode policy and browser canvas implementation. No external conversion API.
export const IMAGE_OUTPUTS=Object.freeze(['original','png','jpg','webp']);
export const IMAGE_QUALITY=Object.freeze([0.7,0.85,0.92,1]);
const MAX_INPUT_BYTES=48*1024*1024;
const MAX_IMAGE_PIXELS=36_000_000;
const MAX_EDGE=16384;
const MIME={png:'image/png',jpg:'image/jpeg',webp:'image/webp'};
export function imageConversionOptions(format,quality){
 if(!IMAGE_OUTPUTS.includes(format))throw new Error('Formato de imagem não permitido.');
 if(typeof quality!=='number'||!IMAGE_QUALITY.includes(quality))
  throw new Error('Qualidade de imagem inválida.');
 return {format,quality};
}
export function sourceImageType(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<12)return null;
 const text=(a,len)=>String.fromCharCode(...bytes.subarray(a,a+len));
 if(bytes[0]===0x89&&text(1,3)==='PNG')return 'png';
 if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'jpg';
 if(text(0,4)==='RIFF'&&text(8,4)==='WEBP')return 'webp';
 if(text(0,4)==='GIF8')return 'gif';
 if(text(0,2)==='BM')return 'bmp';
 if(text(4,4)==='ftyp'&&/avif|avis/.test(text(8,12)))return 'avif';
 return null;
}
export function animatedImage(bytes,type){
 if(type==='gif')return true; // no silent lossy animation flattening
 if(type==='avif'&&String.fromCharCode(...bytes.subarray(8,12))==='avis')return true;
 if(type==='webp'){
  for(let i=12;i+4<=Math.min(bytes.length,4096);i++){
   const chunk=String.fromCharCode(...bytes.subarray(i,i+4));
   if(chunk==='ANIM'||chunk==='ANMF')return true;
  }
  // Extended WebP feature flag: bit 1 indicates animation.
  if(String.fromCharCode(...bytes.subarray(12,16))==='VP8X'&&bytes.length>20)
   return Boolean(bytes[20]&0x02);
 }
 return false;
}
export function safeImageFilename(title,id,format){
 if(!['png','jpg','webp'].includes(format)||typeof id!=='string')throw new Error('Arquivo inválido.');
 const safe=(String(title||'imagem').normalize('NFKD').replace(/[^a-zA-Z0-9_-]/g,'_')
  .replace(/_+/g,'_').slice(0,75)||'imagem');
 const key=id.replace(/[^a-zA-Z0-9]/g,'').slice(0,8);
 if(!key)throw new Error('Identificador de imagem inválido.');
 return 'MediaFinder/Imagens/'+safe+'_'+key+'.'+format;
}
async function readLimitedImage(response,signal,maxBytes=MAX_INPUT_BYTES){
 if(response.status!==200||!response.ok)
  throw new Error('Servidor não permitiu obter a imagem completa (HTTP '+response.status+').');
 const headerType=(response.headers.get('content-type')||'').toLowerCase();
 if(headerType.includes('html')||headerType.includes('json')||headerType.includes('svg'))
  throw new Error('O servidor retornou outro conteúdo em vez da imagem.');
 if(Number(response.headers.get('content-length')||0)>maxBytes)
  throw new Error('Imagem muito grande para conversão em memória. Baixe no formato original.');
 if(!response.body)throw new Error('Não foi possível ler os dados da imagem.');
 const reader=response.body.getReader(),parts=[];
 let size=0;
 try{
  while(true){
   if(signal?.aborted)throw new Error('Conversão cancelada.');
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>maxBytes)throw new Error('Imagem excede 48 MB; use o download original.');
   parts.push(value);
  }
 }finally{await reader.cancel().catch(()=>{});}
 if(size<12)throw new Error('Imagem incompleta.');
 const bytes=new Uint8Array(size);
 let offset=0;
 for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 return bytes;
}
export async function transcodeImage(url,{format,quality=0.92,signal,
 fetcher=(...args)=>globalThis.fetch(...args),
 bitmapFactory=blob=>globalThis.createImageBitmap(blob),
 canvasFactory=()=>document.createElement('canvas')
}={}){
 imageConversionOptions(format,quality);
 if(format==='original')throw new Error('A opção original não requer conversão.');
 let parsed;
 try{parsed=new URL(url);}catch{throw new Error('URL de imagem inválida.');}
 if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)
  throw new Error('Endereço de imagem não permitido.');
 const response=await fetcher(url,{method:'GET',credentials:'include',
  redirect:'follow',cache:'no-store',signal});
 const bytes=await readLimitedImage(response,signal);
 const type=sourceImageType(bytes);
 if(!type)throw new Error('Arquivo não possui assinatura de imagem compatível.');
 if(animatedImage(bytes,type))
  throw new Error('Imagem animada: converter removeria os quadros. Baixe o arquivo original.');
 let bitmap;
 try{
  bitmap=await bitmapFactory(new Blob([bytes],{type:type==='jpg'?'image/jpeg':'image/'+type}));
  const width=bitmap.width,height=bitmap.height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
     width>MAX_EDGE||height>MAX_EDGE||width*height>MAX_IMAGE_PIXELS)
   throw new Error('Resolução grande demais para conversão segura. Baixe no formato original.');
  if(signal?.aborted)throw new Error('Conversão cancelada.');
  const canvas=canvasFactory();
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{alpha:format!=='jpg'});
  if(!ctx)throw new Error('Canvas 2D indisponível para converter esta imagem.');
  if(format==='jpg'){
   ctx.fillStyle='#ffffff';
   ctx.fillRect(0,0,width,height);
  }
  ctx.drawImage(bitmap,0,0,width,height);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(
   converted=>converted?resolve(converted):reject(new Error('O navegador não conseguiu codificar a imagem.')),
   MIME[format],format==='png'?undefined:quality
  ));
  canvas.width=0;canvas.height=0;
  if(blob.type!==MIME[format]||blob.size<1)
   throw new Error('O navegador não suporta este formato de saída.');
  if(signal?.aborted)throw new Error('Conversão cancelada.');
  return {blob,format,width,height,sourceType:type};
 }finally{bitmap?.close?.();}
}
