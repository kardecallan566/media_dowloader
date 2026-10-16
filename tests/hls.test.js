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
