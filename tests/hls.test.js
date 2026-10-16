import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMedia, parseMaster, StreamDownloader, playlistExpiry } from '../hls-downloader.js';

test('HLS VOD detects complete TS segments', () => {
 const out=parseMedia('#EXTM3U\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n#EXT-X-ENDLIST', 'https://example.org/hls/list.m3u8');
 assert.equal(out.extension,'ts');
 assert.deepEqual(out.segments.map(x=>x.url),['https://example.org/hls/a.ts','https://example.org/hls/b.ts']);
});
test('master playlist sorts highest bandwidth first', () => {
 const out=parseMaster('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=640x360\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=1280x720\nhigh.m3u8', 'https://example.org/master.m3u8');
 assert.equal(out[0].resolution,'1280x720');
});
test('fMP4 includes initialization map', () => {
 const out=parseMedia('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nvideo1.m4s\n#EXT-X-ENDLIST','https://example.org/a/index.m3u8');
 assert.equal(out.extension,'mp4');
 assert.equal(out.segments[0].map.url,'https://example.org/a/init.mp4');
});
test('live playlists refuse partial download', () => {
 assert.throws(()=>parseMedia('#EXTM3U\n#EXTINF:4,\none.ts','https://example.org/index.m3u8'),/ao vivo/);
});
test('encrypted HLS refuses corrupt output', () => {
 assert.throws(()=>parseMedia('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST','https://example.org/index.m3u8'),/criptografia/);
});
test('byte range offsets are preserved', () => {
 const out=parseMedia('#EXTM3U\n#EXT-X-BYTERANGE:4@0\nfile.ts\n#EXT-X-BYTERANGE:4\nfile.ts\n#EXT-X-ENDLIST','https://example.org/index.m3u8');
 assert.deepEqual(out.segments.map(s=>s.range),[[0,3],[4,7]]);
});

test('Signed playlist expiration is recognized conservatively',()=>{
 assert.equal(playlistExpiry('https://example.org/hls.m3u8?expires=1700000000',1800000000000),'expired');
 assert.equal(playlistExpiry('https://example.org/hls.m3u8?expires=1893456000',1800000000000),'valid');
 assert.equal(playlistExpiry('https://example.org/hls.m3u8?token=abc',1800000000000),null);
});
test('HLS access denial is identified without retrying protected playlist',async()=>{
 let fetches=0;
 const job=new StreamDownloader('https://cdn.example.org/play.m3u8',{
  fetcher:async()=>{fetches++;return {status:403,ok:false};},requestTimeoutMs:100
 });
 await assert.rejects(job.prepare(),/HTTP 403 na playlist/);
 assert.equal(fetches,1);
});
test('HLS playlist hangs are interrupted after finite timeout',async()=>{
 const job=new StreamDownloader('https://cdn.example.org/play.m3u8',{
  fetcher:(url,{signal})=>new Promise((resolve,reject)=>{
   signal.addEventListener('abort',()=>reject(Object.assign(new Error('Abort'),{name:'AbortError'})),{once:true});
  }),requestTimeoutMs:20
 });
 await assert.rejects(job.prepare(),/não respondeu em 0 segundos|não respondeu em 1 segundos/);
});
test('HLS segment access denied does not burn all retries',async()=>{
 let count=0;
 const job=new StreamDownloader('https://cdn.example.org/hls.m3u8',{
  fetcher:async()=>{count++;return {status:403,ok:false};},requestTimeoutMs:100
 });
 await assert.rejects(job.requestPart({url:'https://cdn.example.org/part.ts',range:null}),/HTTP 403 no segmento/);
 assert.equal(count,1);
});

test('native browser fetch is called without binding it to StreamDownloader',async()=>{
 const previous=globalThis.fetch;
 const requests=[];
 globalThis.fetch=function(url,options){
  assert.equal(this,globalThis,'Browser fetch requires the window/global receiver');
  requests.push(url);
  if(url.endsWith('.m3u8'))return Promise.resolve({status:200,ok:true,text:async()=>
   '#EXTM3U\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST'});
  return Promise.resolve({status:200,ok:true,arrayBuffer:async()=>new Uint8Array([0x47,0,0,0]).buffer});
 };
 try{
  const downloader=new StreamDownloader('https://media.example.test/vod.m3u8');
  const manifest=await downloader.prepare();
  assert.equal(manifest.segments.length,1);
  const result=await downloader.download();
  assert.equal(result.extension,'ts');
  assert.equal(result.blob.size,4);
  assert.equal(requests.length,2);
 }finally{globalThis.fetch=previous;}
});

test('injected fetch is called as a plain function, not as downloader method',async()=>{
 let thisValue;
 const fetcher=function(url){thisValue=this;return Promise.resolve({status:200,ok:true,text:async()=>
  '#EXTM3U\n#EXTINF:2,\nseg.ts\n#EXT-X-ENDLIST'});};
 const downloader=new StreamDownloader('https://example.org/video.m3u8',{fetcher});
 await downloader.prepare();
 assert.equal(thisValue,undefined);
});

test('master playlist falls back from video-only to a variant with muxed audio',async()=>{
 const manifest='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,AUDIO="a1"\nhigh.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nstandard.m3u8';
 const media='#EXTM3U\n#EXTINF:5,\nvideo.ts\n#EXT-X-ENDLIST';
 const requested=[];
 const fetcher=async url=>{requested.push(url);return {status:200,ok:true,text:async()=>url.endsWith('master.m3u8')?manifest:media};};
 const job=new StreamDownloader('https://example.org/master.m3u8',{fetcher});
 await job.prepare();
 assert.ok(requested.some(url=>url.endsWith('standard.m3u8')));
 assert.ok(!requested.some(url=>url.endsWith('high.m3u8')));
});
test('all HLS qualities with separate audio fail clearly instead of saving silent video',async()=>{
 const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="sound.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="a"\nvideo.m3u8';
 const job=new StreamDownloader('https://example.org/master.m3u8',{
  fetcher:async()=>({status:200,ok:true,text:async()=>master})
 });
 await assert.rejects(job.prepare(),/áudio separado/);
});

test('HLS writes a large VOD incrementally without an artificial file-size cap',async()=>{
 const segmentCount=4;
 const chunks=[];
 let progress=[];
 const manifest='#EXTM3U\n'+Array.from({length:segmentCount},(_,i)=>
  '#EXTINF:10,\npart'+i+'.ts\n').join('')+'#EXT-X-ENDLIST';
 const fetcher=async url=>({
  status:200,ok:true,
  text:async()=>manifest,
  arrayBuffer:async()=>new Uint8Array(4096).fill(0x47).buffer
 });
 const job=new StreamDownloader('https://media.example.test/film.m3u8',
  {fetcher,maxBytes:1024});
 await job.prepare();
 const result=await job.downloadToWriter({write:async chunk=>{chunks.push(chunk.byteLength);}},
  p=>progress.push(p));
 assert.equal(result.bytes,segmentCount*4096);
 assert.equal(result.extension,'ts');
 assert.equal(chunks.length,segmentCount);
 assert.equal(progress.at(-1).done,segmentCount);
});
test('selected HLS quality must be one of the advertised master variants',async()=>{
 const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\n1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n720.m3u8';
 const media='#EXTM3U\n#EXTINF:4,\none.ts\n#EXT-X-ENDLIST';
 const calls=[];
 const job=new StreamDownloader('https://video.test/master.m3u8',{fetcher:async url=>{
  calls.push(url);return {ok:true,status:200,text:async()=>url.endsWith('/master.m3u8')?master:media};
 }});
 await assert.rejects(job.prepare('https://untrusted.test/other.m3u8'),/Qualidade indisponível/);
 assert.equal(calls.some(u=>u.startsWith('https://untrusted.test')),false);
 const selected=await job.prepare('https://video.test/720.m3u8');
 assert.equal(selected.segments.length,1);
 assert.ok(calls.includes('https://video.test/720.m3u8'));
});
