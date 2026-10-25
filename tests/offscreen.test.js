import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../offscreen.js',import.meta.url),'utf8');
function createOffscreenHarness(){
 let listener;
 const calls=[],released=[];
 let signalSave;
 const saved=new Promise(resolve=>signalSave=resolve);
 class StubStream {
  constructor(){this.controller=new AbortController();}
  async prepare(){return {segments:[{url:'https://cdn.example/1.ts'}]};}
  async downloadToWriter(writer,progress){
   await writer.write(new Uint8Array([0x47,0,0,0]));
   progress({done:1,total:1,bytes:4});
   return {bytes:4,extension:'ts'};
  }
  cancel(){this.controller.abort();}
 }
 const context={
  Map,AbortController,Blob,setTimeout,clearTimeout,
  URL:{
   createObjectURL:()=> 'blob:chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/abc',
   revokeObjectURL:url=>released.push(url)
  },
  StreamDownloader:StubStream,
  parseRange:()=>null,
  validateCompleteVideo:()=>({ok:true}),
  downloadRangesToWriter:async()=>({bytes:0}),
  transcodeImage:async()=>({blob:new Blob([new Uint8Array([137,80,78,71,0,0])],{type:'image/png'}),
    format:'png',width:32,height:32,sourceType:'webp'}),
  safeImageFilename:(title,id,format)=>'MediaFinder/Imagens/'+title+'_'+id+'.'+format,
  openTemporaryMedia:async()=>({
   writer:{write:async()=>{}},
   finish:async()=>({file:new Blob([new Uint8Array([0x47,0,0,0])]),cleanup:async()=>{}}),
   cleanup:async()=>{}
  }),
  chrome:{
   runtime:{
    onMessage:{addListener:fn=>listener=fn},
    sendMessage:async message=>{
     calls.push(message);
     if(message.cmd==='saveBlobDownload'){
      signalSave(message);
      return {ok:true,downloadId:42,state:'in_progress'};
     }
     return {ok:true};
    }
   }
  }
 };
 const clean=source.replace(/^import .*;\s*$/gm,'');
 vm.runInNewContext(clean,context);
 return {send:(message)=>new Promise(resolve=>listener(message,{},resolve)),
  saved,calls,released};
}
test('offscreen HLS delegates Chrome saving to background, not unavailable chrome.downloads',async()=>{
 const fake=createOffscreenHarness();
 assert.deepEqual(JSON.parse(JSON.stringify(await fake.send({
  cmd:'runHlsJob',id:'job-1',tabId:7,url:'https://cdn.example/a.m3u8',title:'Video'
 }))),{ok:true});
 const saved=await fake.saved;
 assert.equal(saved.cmd,'saveBlobDownload');
 assert.equal(saved.filename,'MediaFinder/Video.ts');
 assert.ok(saved.url.startsWith('blob:'));
 await fake.send({cmd:'savedBlobFinished',downloadId:42});
 // Event delivery can win the race against saveBlob()'s promise continuation.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(fake.released.length,1);
 assert.equal(fake.released[0],saved.url);
});
test('offscreen never accesses chrome.downloads directly on HLS or direct video path',()=>{
 assert.doesNotMatch(source,/chrome\.downloads\./);
 assert.match(source,/await saveBlob\(message,objectUrl/);
});

test('offscreen image conversion saves real PNG filename through background API',async()=>{
 const mock=createOffscreenHarness();
 const result=await mock.send({cmd:'runImageJob',id:'picture01',tabId:7,
  url:'https://cdn.example/picture.webp',title:'Imagem',format:'png',quality:0.92});
 assert.equal(result.ok,true);
 const saved=await mock.saved;
 assert.equal(saved.cmd,'saveBlobDownload');
 assert.equal(saved.filename,'MediaFinder/Imagens/Imagem_picture01.png');
 assert.ok(saved.url.startsWith('blob:chrome-extension:'));
 await mock.send({cmd:'savedBlobFinished',downloadId:42});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(mock.released.length,1);
});
