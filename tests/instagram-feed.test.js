import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../content.js',import.meta.url),'utf8');
function simulate(links,site='https://www.instagram.com/'){
 const messages=[];
 const anchors=links.map(href=>({href}));
 const scope={
  parentElement:null,
  closest:()=>null,
  querySelectorAll:(selector)=>selector==='video'?[video]:selector==='a[href]'?anchors:[]
 };
 const video={
  parentElement:scope,tagName:'VIDEO',
  poster:'',currentSrc:'blob:https://www.instagram.com/123',src:'blob:https://www.instagram.com/123',
  duration:72,videoWidth:1080,videoHeight:1920,
  getBoundingClientRect:()=>({width:600,height:400,top:0,bottom:400,left:0,right:600}),
  getAttribute:()=>'',closest:()=>null,querySelectorAll:()=>[]
 };
 const url=new URL(site);
 const location={href:url.href,hostname:url.hostname,origin:url.origin,pathname:url.pathname};
 const document={
  documentElement:{},title:'Instagram',querySelector:()=>null,
  querySelectorAll:selector=>selector==='video,audio'?[video]:[],
  addEventListener:()=>{}
 };
 const context={document,location,innerHeight:900,innerWidth:900,URL,
  MutationObserver:class{observe(){}},addEventListener:()=>{},
  setTimeout:()=>0,clearTimeout:()=>{},
  chrome:{runtime:{sendMessage:async m=>{messages.push(m);},onMessage:{addListener:()=>{}}}}
 };
 vm.runInNewContext(source,context);
 return messages[0].items.find(i=>i.type==='Player');
}
test('Instagram feed player is matched to a single nearby Reel permalink',()=>{
 const player=simulate(['https://www.instagram.com/reel/ABC123/?utm=test']);
 assert.equal(player.pageUrl,'https://www.instagram.com/reel/ABC123/');
 assert.equal(player.url,'https://www.instagram.com/');
});
test('multiple nearby posts are ambiguous and never select random Reel',()=>{
 const player=simulate(['https://www.instagram.com/reel/ABC123/',
  'https://www.instagram.com/reel/DEF456/']);
 assert.equal(player.pageUrl,null);
});
test('no Reel link means player recognized but not a native download target',()=>{
 const player=simulate([]);
 assert.equal(player.pageUrl,null);
 assert.equal(player.engine,'MSE / blob');
});

test('Pinterest feed player uses one unique nearby Pin link instead of guessed preloaded HLS',()=>{
 const p=simulate(['https://br.pinterest.com/pin/123456789012345/'],'https://br.pinterest.com/');
 assert.equal(p.pageUrl,'https://www.pinterest.com/pin/123456789012345/');
});
test('Pinterest feed with multiple pins cannot select the wrong video automatically',()=>{
 const p=simulate(['https://br.pinterest.com/pin/123456789012345/','https://br.pinterest.com/pin/987654321012345/'],'https://br.pinterest.com/');
 assert.equal(p.pageUrl,null);
});
