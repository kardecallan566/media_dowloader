import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRangedPreview, downloadRanges } from '../range-downloader.js';

const makeBytes=(size)=>{
 const data=new Uint8Array(size);
 data.set([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,0,0,0,0,0,0,0,0]);
 for(let i=24;i<size;i++)data[i]=i%251;
 return data;
};
test('HTTP 206 bytes 0-999 of a larger MP4 enables safe whole-file range strategy',()=>{
 const headers=new Headers({'content-range':'bytes 0-999/110000','content-type':'video/mp4','content-length':'1000'});
 const result=evaluateRangedPreview(206,headers,makeBytes(1000),'Video','mp4');
 assert.equal(result.state,'range');
 assert.equal(result.canDownload,true);
 assert.equal(result.size,110000);
});
test('non-zero range is not a valid progressive initialization',()=>{
 const headers=new Headers({'content-range':'bytes 1000-1999/110000','content-type':'video/mp4'});
 assert.equal(evaluateRangedPreview(206,headers,makeBytes(1000),'Video','mp4').canDownload,false);
});
test('reject single small segment that cannot be a full video',()=>{
 const headers=new Headers({'content-range':'bytes 0-999/1000','content-type':'video/mp4'});
 assert.equal(evaluateRangedPreview(206,headers,makeBytes(1000),'Video','mp4').canDownload,false);
});
test('assemble all verified byte ranges into original order',async()=>{
 const all=makeBytes(100000);
 let requests=0;
 const fakeFetch=async(url,options)=>{
  const m=options.headers.Range.match(/bytes=(\d+)-(\d+)/);
  const from=Number(m[1]),to=Number(m[2]);
  requests++;
  const body=all.slice(from,to+1);
  return {
   status:206,headers:new Headers({'content-range':`bytes ${from}-${to}/${all.length}`}),
   arrayBuffer:async()=>body.buffer
  };
 };
 const result=await downloadRanges('https://media.example/video.mp4',all.length,
  {fetcher:fakeFetch,chunkSize:16384,concurrency:3});
 assert.deepEqual(result,all);
 assert.equal(requests,7);
});
test('fail closed on servers ignoring ranges',async()=>{
 const fakeFetch=async()=>({status:200,headers:new Headers(),arrayBuffer:async()=>new ArrayBuffer(1000)});
 await assert.rejects(downloadRanges('https://media.example/video.mp4',110000,
  {fetcher:fakeFetch,chunkSize:16384}),/intervalos incompatível/);
});
test('fail closed when range totals change across requests',async()=>{
 const fakeFetch=async(url,options)=>{
  const m=options.headers.Range.match(/bytes=(\d+)-(\d+)/);
  const from=Number(m[1]),to=Number(m[2]);
  return {status:206,headers:new Headers({'content-range':`bytes ${from}-${to}/120000`}),
   arrayBuffer:async()=>new Uint8Array(to-from+1).buffer};
 };
 await assert.rejects(downloadRanges('https://media.example/video.mp4',110000,
  {fetcher:fakeFetch,chunkSize:16384}),/intervalos incompatível/);
});
