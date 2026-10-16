import test from 'node:test';
import assert from 'node:assert/strict';
import {contextualSource,signedExpiry,preferredDownloadMethod} from '../download-routing.js';

const page='https://topanimes.net/assistir/episodio';
const hls='https://doce-de-leite-vegano.b-cdn.net/series/vod.m3u8?expires=1893456000&token=abc';

test('TopAnimes known HLS uses native helper by default, not browser fetch',()=>{
 assert.equal(preferredDownloadMethod(page,{type:'HLS',url:hls},1760580000000),'native');
 assert.deepEqual(contextualSource(page,hls,'HLS'),{
  pageHost:'topanimes.net',sourceHost:'doce-de-leite-vegano.b-cdn.net',type:'HLS',origin:'https://topanimes.net'
 });
});
test('ordinary HLS continues using the browser route',()=>{
 assert.equal(preferredDownloadMethod('https://example.org/episode',
  {type:'HLS',url:'https://cdn.example.org/video.m3u8'}),'browser');
});
test('matching CDN on another page is not a recognized contextual source',()=>{
 assert.equal(contextualSource('https://untrusted.example.org/episode',hls,'HLS'),null);
 assert.equal(preferredDownloadMethod('https://untrusted.example.org/episode',{type:'HLS',url:hls}),'browser');
 assert.equal(contextualSource('https://topanimes.net.evil.test/ep',hls,'HLS'),null);
 assert.equal(contextualSource('https://topanimes.net/ep','http://doce-de-leite-vegano.b-cdn.net/file.m3u8','HLS'),null);
});
test('signed URLs recognize expiration in seconds and milliseconds',()=>{
 const now=1760580000000;
 assert.equal(signedExpiry('https://x.test/v.m3u8?expires=1700000000',now).expired,true);
 assert.equal(signedExpiry('https://x.test/v.m3u8?expires=1700000000000',now).expired,true);
 assert.equal(signedExpiry('https://x.test/v.m3u8?expires=1893456000',now).expired,false);
 assert.equal(signedExpiry('https://x.test/v.m3u8?expires=1893456000000',now).expired,false);
 assert.equal(signedExpiry('https://x.test/v.m3u8?token=abc',now),null);
});
test('expired source is not retried by browser or native while signed URL is stale',()=>{
 assert.equal(preferredDownloadMethod(page,
  {type:'HLS',url:'https://doce-de-leite-vegano.b-cdn.net/v.m3u8?expires=1700000000'},
  1760580000000),'expired');
 assert.equal(preferredDownloadMethod(page,
  {type:'HLS',url:'https://doce-de-leite-vegano.b-cdn.net/v.m3u8?expires=1700000000000'},
  1760580000000),'expired');
});
test('MP4 remains available via the existing browser and secondary contextual options',()=>{
 const item={type:'Video',url:'https://cdn-s01.pixel-sus-4k-image.com/stream/example.mp4'};
 assert.equal(preferredDownloadMethod('https://sushianimes.com.br/episodio',item),'browser');
 assert.ok(contextualSource('https://sushianimes.com.br/episodio',item.url,item.type));
});
