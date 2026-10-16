// OPFS-backed temporary media assembly. Disk quota replaces fixed 96/450 MB caps.
// Each job has a private file and is removed after Chrome finishes saving.
export async function openTemporaryMedia(id){
 if(typeof navigator==='undefined'||!navigator.storage?.getDirectory)
  throw new Error('Este navegador não oferece armazenamento temporário OPFS; use o assistente local.');
 const root=await navigator.storage.getDirectory();
 const dir=await root.getDirectoryHandle('MediaFinder-temp',{create:true});
 const safe=String(id||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,65);
 if(!safe)throw new Error('Identificador de download inválido.');
 const name='download-'+safe+'.part';
 const handle=await dir.getFileHandle(name,{create:true});
 const writer=await handle.createWritable();
 let closed=false;
 const cleanup=async()=>{
  if(!closed){
   try{await writer.abort();}catch{}
   closed=true;
  }
  try{await dir.removeEntry(name);}catch{}
 };
 return {
  writer,
  async finish(){
   await writer.close();closed=true;
   const file=await handle.getFile();
   if(file.size===0)throw new Error('Não foram recebidos dados.');
   return {file,cleanup};
  },
  cleanup
 };
}
