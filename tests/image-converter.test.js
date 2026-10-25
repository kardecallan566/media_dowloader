import test from 'node:test';
import assert from 'node:assert/strict';
import {imageConversionOptions,sourceImageType,animatedImage,safeImageFilename,
 transcodeImage} from '../image-converter.js';

const png=new Uint8Array([0x89,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
const webp=new Uint8Array([82,73,70,70,20,0,0,0,87,69,66,80,86,80,56,32,10,0,0,0,0,0,0,0]);
const jpeg=new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1,0,0]);
const gif=new Uint8Array([71,73,70,56,57,97,0,0,0,0,0,0]);
function run(content,{format='png',quality=0.92,width=64,height=64,
 responseType='image/webp',outputType=null}={}){
 const operations=[],calls=[],closed=[];
 const bitmap={width,height,close:()=>closed.push('close')};
 const canvas={
  getContext:()=>({
   set fillStyle(value){operations.push(['color',value]);},
   fillRect(...args){operations.push(['fill',...args]);},
   drawImage(...args){operations.push(['draw',args[1],args[2],args[3],args[4]]);}
  }),
  toBlob(callback,type,amount){
   operations.push(['encode',type,amount]);
   callback(new Blob([new Uint8Array([1,2,3,4])],{type:outputType||type}));
  }
 };
 return {operations,calls,closed,
  promise:transcodeImage('https://assets.example/asset.webp?token=abc',{
   format,quality,
   fetcher:async(url,options)=>{
    calls.push({url,options});
    return new Response(content,{status:200,headers:{'Content-Type':responseType}});
   },
   bitmapFactory:async blob=>{calls.push({decodedType:blob.type});return bitmap;},
   canvasFactory:()=>canvas
  })
 };
}
test('WebP is decoded and converted to a true PNG with transparency preserved',async()=>{
 const fake=run(webp,{format:'png'});
 const result=await fake.promise;
 assert.equal(result.format,'png');
 assert.equal(result.sourceType,'webp');
 assert.equal(result.blob.type,'image/png');
 assert.equal(result.width,64);
 assert.ok(fake.operations.some(x=>x[0]==='draw'));
 assert.ok(!fake.operations.some(x=>x[0]==='fill'));
 assert.equal(fake.calls[0].url,'https://assets.example/asset.webp?token=abc');
 assert.equal(fake.calls[0].options.method,'GET');
 assert.equal(fake.calls[0].options.credentials,'include');
 assert.equal(fake.closed.length,1);
});
test('WebP → JPG explicitly fills transparent canvas with white before rendering',async()=>{
 const fake=run(webp,{format:'jpg',quality:0.85});
 const output=await fake.promise;
 assert.equal(output.blob.type,'image/jpeg');
 const fill=fake.operations.findIndex(x=>x[0]==='fill');
 const draw=fake.operations.findIndex(x=>x[0]==='draw');
 assert.ok(fill>=0&&draw>fill);
 assert.deepEqual(fake.operations[fill],['fill',0,0,64,64]);
 assert.ok(fake.operations.some(x=>x[0]==='color'&&x[1]==='#ffffff'));
 assert.ok(fake.operations.some(x=>x[0]==='encode'&&x[1]==='image/jpeg'&&x[2]===0.85));
});
test('PNG and JPEG inputs can be saved in WebP, PNG and JPEG without fake extensions',async()=>{
 for(const [input,format,expected] of [
  [png,'webp','image/webp'],[png,'jpg','image/jpeg'],
  [jpeg,'png','image/png'],[jpeg,'webp','image/webp']]){
  const fake=run(input,{format});
  assert.equal((await fake.promise).blob.type,expected);
 }
});
test('output MIME mismatch is refused instead of saving a wrongly labeled image',async()=>{
 const fake=run(png,{format:'jpg',outputType:'image/png'});
 await assert.rejects(fake.promise,/não suporta este formato de saída/);
 assert.equal(fake.closed.length,1);
});
test('rejects animation rather than silently saving only the first frame',async()=>{
 assert.equal(animatedImage(gif,'gif'),true);
 assert.equal(animatedImage(new Uint8Array([...webp.slice(0,20),2,0,0,0]),'webp'),true);
 assert.equal(animatedImage(webp,'webp'),false);
 await assert.rejects(run(gif,{format:'png'}).promise,/animada/);
});
test('cannot fetch HTML, oversized responses or replace host authorization',async()=>{
 const opts={format:'png',fetcher:async()=>new Response('<html>no image</html>',{
  status:200,headers:{'Content-Type':'text/html'}
 })};
 await assert.rejects(transcodeImage('https://site.test/a.webp',opts),/outro conteúdo/);
 await assert.rejects(transcodeImage('javascript:alert(1)',opts),/não permitido/);
 await assert.rejects(transcodeImage('https://x.test/file.png',{format:'png',
  fetcher:async()=>new Response(png,{headers:{'Content-Length':'55000000'}})}),/muito grande/);
 await assert.rejects(transcodeImage('https://x.test/file.png',{format:'png',
  fetcher:async()=>new Response(new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12]))}),/assinatura/);
 await assert.rejects(transcodeImage('https://x.test/file.png',{format:'png',
  bitmapFactory:async()=>({width:10000,height:10000,close(){}}),
  fetcher:async()=>new Response(png)}),/Resolução grande demais/);
});
test('only vetted formats and quality choices are accepted',()=>{
 for(const bad of ['svg','gif','bmp','avif','tiff','../../file','PNG'])
  assert.throws(()=>imageConversionOptions(bad,0.92),/não permitido/);
 for(const bad of [null,0.123,100,'0.85'])
  assert.throws(()=>imageConversionOptions('jpg',bad),/inválida/);
 assert.deepEqual(imageConversionOptions('jpg',0.85),{format:'jpg',quality:0.85});
});
test('source detection and download name use real image extension',()=>{
 assert.equal(sourceImageType(webp),'webp');
 assert.equal(sourceImageType(png),'png');
 assert.equal(sourceImageType(jpeg),'jpg');
 assert.equal(sourceImageType(gif),'gif');
 assert.equal(safeImageFilename('Foto 01 ♡','abc-xyz99','png'),
  'MediaFinder/Imagens/Foto_01__abcxyz99.png');
 assert.throws(()=>safeImageFilename('../foto','', 'png'),/Identificador/);
 assert.throws(()=>safeImageFilename('foto','abcd','svg'),/inválido/);
});
