// Verify basic HTTP range semantics and actual media signatures before saving.
export function parseRange(value) {
 const m=String(value||'').match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i);
 if(!m)return null;
 const start=Number(m[1]),end=Number(m[2]),total=m[3]==='*'?null:Number(m[3]);
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end)return null;
 if(total!==null&&(!Number.isSafeInteger(total)||end>=total))return null;
 return {start,end,total,partial:start>0||(total!==null&&end<total-1)};
}
function mp4Atoms(bytes){
 const types=[];
 let offset=0;
 for(let count=0;count<200&&offset+8<=bytes.length;count++){
  const n=(bytes[offset]*16777216+bytes[offset+1]*65536+bytes[offset+2]*256+bytes[offset+3]);
  const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
  if(!/^[A-Za-z0-9 ]{4}$/.test(type)||n<8)break;
  types.push(type);
  if(n>bytes.length-offset)break;
  offset+=n;
 }
 return types;
}

export function validateProbe(status,headers,bytes,type,ext){
 const header=n=>headers.get?headers.get(n):headers[n]||null;
 const range=parseRange(header('content-range'));
 const length=Number(header('content-length'))||null;
 const result={state:'blocked',reason:'',size:range?.total||length,canDownload:false};
 if(status===401||status===403){result.reason='Servidor exige autorização.';return result;}
 if(status<200||status>=300){result.reason='Resposta HTTP '+status;return result;}
 if(range?.partial){result.state='partial';result.reason='Resposta contém apenas bytes '+range.start+'-'+range.end+' de '+range.total;return result;}
 if(status===206&&!range){result.reason='Resposta parcial sem extensão verificável.';return result;}
 const mime=String(header('content-type')||'').toLowerCase();
 if(mime.includes('html')||mime.includes('json')){result.reason='Servidor retornou HTML ou JSON em vez de mídia.';return result;}
 const small=type==='Video'?16384:type==='Image'?100:256;
 if(length!==null&&length<small){result.state='partial';result.reason='Resposta pequena demais: '+length+' bytes.';return result;}
 const str=(at,n)=>String.fromCharCode(...bytes.subarray(at,at+n));
 const mp4=bytes.length>=12&&str(4,4)==='ftyp';
 const atoms=mp4?mp4Atoms(bytes):[];
 const partialMp4=bytes.length>=8&&(['styp','moof'].includes(str(4,4))||(!mp4&&atoms.includes('moof')));
 const ebml=bytes.length>=4&&[0x1a,0x45,0xdf,0xa3].every((n,i)=>bytes[i]===n);
 const image=bytes.length>=12&&(
  (bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)||
  (bytes[0]===0x89&&str(1,3)==='PNG')||
  str(0,4)==='GIF8'||(str(0,4)==='RIFF'&&str(8,4)==='WEBP')||
  (str(4,4)==='ftyp'&&/avif|avis/.test(str(8,12)))||str(0,2)==='BM');
 const audio=bytes.length>=4&&(str(0,3)==='ID3'||(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0)||
  str(0,4)==='OggS'||str(0,4)==='fLaC'||(str(0,4)==='RIFF'&&str(8,4)==='WAVE')||mp4);
 const valid=type==='Video'?(ext==='webm'?ebml:(mp4||ebml)&&!partialMp4):type==='Image'?image:audio;
 if(!valid){result.reason=partialMp4?'Fonte fMP4 segmentada, não arquivo completo.':'Cabeçalho incompatível com mídia completa.';return result;}
 // A tiny ftyp/moov initialization box is not an entire playable video.
 if(type==='Video'&&mp4){
  if(length!==null&&length<65536){
   result.state='partial';result.reason='MP4 pequeno, possivelmente apenas inicialização.';return result;
  }
  if(length!==null&&bytes.length>=length&&(!atoms.includes('mdat')||!atoms.includes('moov'))){
   result.state='partial';result.reason='MP4 inspecionado sem átomos completos de vídeo (moov + mdat).';return result;
  }
  if(!atoms.includes('mdat')&&atoms.includes('moov')){
   result.state='uncertain';result.reason='MP4 com índice de inicialização, mas sem dados de vídeo confirmados.';return result;
  }
 }
 if(length===null&&(!range||range.total===null)){
  result.state='uncertain';result.reason='Cabeçalho válido, porém o tamanho do arquivo não é conhecido.';return result;
 }
 result.state='likely';result.canDownload=true;
 result.reason='Arquivo direto com assinatura válida e tamanho plausível. A integridade final ainda deve ser verificada.';
 return result;
}

export function validateCompleteVideo(bytes,ext){
 if(!bytes||bytes.byteLength<16384)return {ok:false,reason:'O arquivo completo contém menos de 16 KB.'};
 if(ext==='webm'){
  const good=bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
  return {ok:good,reason:good?'':'WebM sem cabeçalho EBML.'};
 }
 if(!['mp4','m4v','mov'].includes(ext))return {ok:false,reason:'Este formato requer outro validador.'};
 const atoms=mp4Atoms(bytes);
 const good=atoms.includes('ftyp')&&atoms.includes('moov')&&atoms.includes('mdat');
 return {ok:good,reason:good?'':'O arquivo não contém cabeçalho, índice e dados MP4 completos (ftyp/moov/mdat).'};
}
