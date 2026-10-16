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
  async download(progress){
   progress({done:1,total:1,bytes:4});
   return {blob:new Blob([new Uint8Array([0x47,0,0,0])]),extension:'ts'};
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
  downloadRanges:async()=>new Uint8Array(0),RANGE_MAX_BYTES:96*1024*1024,
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
