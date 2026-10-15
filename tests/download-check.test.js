import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRange,validateProbe} from '../download-check.js';
const http=(fields={})=>new Headers(fields);
const box=(name,payload=0)=>{
 const size=payload+8,bytes=new Uint8Array(size);
 bytes[0]=(size>>>24)&255;bytes[1]=(size>>>16)&255;bytes[2]=(size>>>8)&255;bytes[3]=size&255;
 bytes.set([...name].map(s=>s.charCodeAt(0)),4);return bytes;
};
const join=(...arrays)=>{const out=new Uint8Array(arrays.reduce((a,b)=>a+b.length,0));let offset=0;
 for(const x of arrays){out.set(x,offset);offset+=x.length;}return out;};
const fullMp4=join(box('ftyp',16),box('moov',32),box('mdat',100000));
const result=(status,fields,bytes=fullMp4,type='Video',ext='mp4')=>
 validateProbe(status,http(fields),bytes,type,ext);

test('accept progressive MP4 with ftyp, moov and mdat',()=>{
 const r=result(200,{'content-type':'video/mp4','content-length':fullMp4.length});
 assert.equal(r.state,'likely');assert.equal(r.canDownload,true);
});
test('block a 1000 byte initialization-only MP4',()=>{
 const fragment=join(box('ftyp',16),box('moov',976));
 const r=result(200,{'content-type':'video/mp4','content-length':fragment.length},fragment);
 assert.equal(r.canDownload,false);assert.equal(r.state,'partial');
});
test('block a 313 KiB MP4 without any video samples',()=>{
 const fragment=join(box('ftyp',16),box('moov',320488));
 const r=result(200,{'content-type':'video/mp4','content-length':fragment.length},fragment);
 assert.equal(r.canDownload,false);assert.equal(r.state,'partial');
});
test('block 206 partial playback response even when total is large',()=>{
 const r=result(206,{'content-type':'video/mp4','content-range':'bytes 0-999/30900000','content-length':'1000'},box('ftyp',24));
 assert.equal(r.canDownload,false);assert.equal(r.state,'partial');
});
test('block fMP4 moof and styp chunks without initialization',()=>{
 for(const type of ['moof','styp']){
  const r=result(200,{'content-type':'video/mp4','content-length':100000},box(type,64));
  assert.equal(r.canDownload,false);
 }
});
test('block HTML login pages and forbidden responses',()=>{
 assert.equal(result(200,{'content-type':'text/html','content-length':120000}).canDownload,false);
 assert.equal(result(403,{'content-type':'video/mp4'}).canDownload,false);
});
test('parse range semantics strictly',()=>{
 assert.deepEqual(parseRange('bytes 0-999/1000'),{start:0,end:999,total:1000,partial:false});
 assert.equal(parseRange('bytes 0-999/10000').partial,true);
 assert.equal(parseRange('bytes 999-1/10000'),null);
});
test('allow valid PNG with sufficient size',()=>{
 const image=new Uint8Array(200);image.set([137,80,78,71,13,10,26,10]);
 const r=result(200,{'content-type':'image/png','content-length':200},image,'Image','png');
 assert.equal(r.canDownload,true);
});
test('do not claim unknown-length downloads are complete',()=>{
 const r=result(200,{'content-type':'video/mp4'},fullMp4);
 assert.equal(r.state,'uncertain');assert.equal(r.canDownload,false);
});
