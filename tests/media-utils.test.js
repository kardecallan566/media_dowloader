import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedUrl,mediaType,group,mediaKey,fileExtension,shouldIgnoreNetwork,ranking,sortMedia} from '../media-utils.js';

test('recognizes video, image, audio and stream resources',()=>{
 assert.equal(mediaType('https://cdn.test/file.mp4'),'Video');
 assert.equal(mediaType('https://cdn.test/file.webp'),'Image');
 assert.equal(mediaType('https://cdn.test/file.m4a'),'Audio');
 assert.equal(mediaType('https://cdn.test/master.m3u8'),'HLS');
 assert.equal(mediaType('https://cdn.test/manifest.mpd'),'DASH');
 assert.equal(mediaType('https://cdn.test/opaque-resource','video/mp4'),'Video');
 assert.equal(mediaType('https://cdn.test/opaque-resource','image/avif'),'Image');
 assert.equal(group('HLS'),'video');
 assert.equal(group('Image'),'image');
});

test('rejects non-web URLs',()=>{
 assert.equal(normalizedUrl('blob:https://example.org/123'),null);
 assert.equal(normalizedUrl('data:image/png;base64,abc'),null);
 assert.equal(normalizedUrl('javascript:alert(1)'),null);
 assert.equal(mediaType('javascript:alert(1)'),null);
});

test('signed Instagram CDN variants map to one logical source',()=>{
 const a='https://scontent-gru1-2.cdninstagram.com/o1/v/t2/f2/m78/abcdef.mp4?oh=AAA&oe=BBB&_nc_ht=gru1';
 const b='https://scontent-gru2-1.cdninstagram.com/o1/v/t2/f2/m78/abcdef.mp4?oh=CCC&oe=DDD&_nc_ht=gru2';
 assert.equal(mediaKey(a,'Video'),mediaKey(b,'Video'));
});

test('different media identities are not collapsed by dedupe',()=>{
 const a='https://example.org/get-file?id=media1&token=abc';
 const b='https://example.org/get-file?id=media2&token=def';
 assert.notEqual(mediaKey(a,'Video'),mediaKey(b,'Video'));
 assert.notEqual(mediaKey('https://example.org/a.mp4','Video'),mediaKey('https://example.org/b.mp4','Video'));
});

test('ignore segment URLs and noisy image network fetches',()=>{
 assert.equal(shouldIgnoreNetwork('https://example.org/init.m4s','Video'),true);
 assert.equal(shouldIgnoreNetwork('https://example.org/video.mp4?bytestart=50','Video'),true);
 assert.equal(shouldIgnoreNetwork('https://example.org/photo.jpg','Image'),true);
 assert.equal(shouldIgnoreNetwork('https://example.org/video.mp4','Video'),false);
});

test('download extension is derived safely from path or MIME',()=>{
 assert.equal(fileExtension({type:'Video',url:'https://example.org/opaque',contentType:'video/mp4'}),'mp4');
 assert.equal(fileExtension({type:'Image',url:'https://example.org/photo.avif',contentType:''}),'avif');
 assert.equal(fileExtension({type:'Audio',url:'https://example.org/sound',contentType:'audio/mpeg'}),'mp3');
 assert.equal(fileExtension({type:'HLS',url:'https://example.org/index.m3u8'}),null);
 assert.equal(fileExtension({type:'Video',url:'https://example.org/opaque',contentType:''}),null);
});

test('page media outranks network fetches and running downloads remain visible',()=>{
 const page={source:'page',visible:true,type:'Video',status:'ready',time:'2026-10-15T00:00:00Z'};
 const network={source:'network',visible:false,type:'Video',status:'ready',time:'2026-10-15T01:00:00Z'};
 assert.ok(ranking(page)>ranking(network));
 assert.equal(sortMedia([network,page])[0],page);
 assert.ok(ranking({...network,status:'running'})>ranking(page));
});
