import test from 'node:test';
import assert from 'node:assert/strict';
import { openTemporaryMedia } from '../opfs-store.js';

test('OPFS writer uses disk-backed chunks and removes file after browser completes',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const written=[];
 let removed=null,closed=false,aborted=false;
 const writer={
  write:async bytes=>{written.push(new Uint8Array(bytes));},
  close:async()=>{closed=true;},
  abort:async()=>{aborted=true;}
 };
 const handle={
  createWritable:async()=>writer,
  getFile:async()=>new Blob(written,{type:'video/mp2t'})
 };
 const directory={
  getFileHandle:async(name,opts)=>{assert.equal(opts.create,true);return handle;},
  removeEntry:async(name)=>{removed=name;}
 };
 const navigatorMock={storage:{getDirectory:async()=>({
  getDirectoryHandle:async(name,options)=>{
   assert.equal(name,'MediaFinder-temp');assert.equal(options.create,true);
   return directory;
  }
 })}};
 try{
  Object.defineProperty(globalThis,'navigator',{value:navigatorMock,configurable:true});
  const temp=await openTemporaryMedia('download-abc');
  await temp.writer.write(new Uint8Array([1,2,3]));
  await temp.writer.write(new Uint8Array([4,5]));
  const {file,cleanup}=await temp.finish();
  assert.equal(file.size,5);
  assert.equal(closed,true);
  assert.equal(aborted,false);
  await cleanup();
  assert.match(removed,/download-download-abc\.part/);
 }finally{
  if(previous)Object.defineProperty(globalThis,'navigator',previous);
  else delete globalThis.navigator;
 }
});
test('OPFS reports unsupported browser instead of silently imposing old size cap',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 try{
  Object.defineProperty(globalThis,'navigator',{value:{storage:{}},configurable:true});
  await assert.rejects(openTemporaryMedia('1'),/OPFS/);
 }finally{
  if(previous)Object.defineProperty(globalThis,'navigator',previous);
  else delete globalThis.navigator;
 }
});
