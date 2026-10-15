import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {group,mediaKey,fileExtension} from '../media-utils.js';
const script=readFileSync(new URL('../content.js',import.meta.url),'utf8');
const youtubeScript=readFileSync(new URL('../youtube-detector.js',import.meta.url),'utf8');

test('Player is a video category, not a downloadable file',()=>{
 assert.equal(group('Player'),'video');
 const first=mediaKey('https://instagram.com/reel/A/','Player','dom-1');
 const second=mediaKey('https://instagram.com/reel/A/','Player','dom-2');
 assert.notEqual(first,second);
 assert.equal(fileExtension({type:'Player',url:'https://instagram.com/reel/A/'}),null);
});

test('Instagram HTML5 blob video is reported as player without a fake downloadable URL',()=>{
 const messages=[];
 const video={
  tagName:'VIDEO',poster:'https://example.org/poster.jpg',currentSrc:'blob:https://www.instagram.com/abc',
  src:'blob:https://www.instagram.com/abc',duration:38,videoWidth:1080,videoHeight:1920,
  getBoundingClientRect:()=>({width:400,height:500,top:0,bottom:500,left:0,right:400}),
  getAttribute:()=>'',closest:()=>null,querySelectorAll:()=>[]
 };
 const document={
  documentElement:{},title:'Instagram',querySelector:()=>null,
  querySelectorAll:selector=>selector==='video,audio'?[video]:[],
  addEventListener:()=>{}
 };
 const context={
  document,location:{href:'https://www.instagram.com/reel/abc/',hostname:'www.instagram.com',origin:'https://www.instagram.com'},
  innerHeight:900,innerWidth:700,URL,MutationObserver:class{observe(){}},
  addEventListener:()=>{},setTimeout:()=>1,clearTimeout:()=>{},
  chrome:{runtime:{onMessage:{addListener:()=>{}},sendMessage:async message=>{messages.push(message);}}}
 };
 vm.runInNewContext(script,context);
 assert.equal(messages.length,1);
 const player=messages[0].items.find(x=>x.type==='Player');
 assert.ok(player);
 assert.equal(player.engine,'MSE / blob');
 assert.equal(player.duration,38);
 assert.equal(player.url,'https://www.instagram.com/reel/abc/');
 assert.equal(messages[0].items.some(x=>x.url.startsWith('blob:')),false);
});

test('YouTube page bridge discovers video metadata and distinguishes progressive from adaptive tracks',()=>{
 const sent=[];
 const id='abcdefghijk';
 const playerResponse={
  videoDetails:{videoId:id,title:'Test playback',lengthSeconds:'125'},
  streamingData:{
   formats:[{url:'https://r1.googlevideo.com/videoplayback?itag=18',mimeType:'video/mp4; codecs="avc1"',qualityLabel:'360p',audioQuality:'AUDIO_QUALITY_MEDIUM'}],
   adaptiveFormats:[{mimeType:'video/mp4'},{mimeType:'audio/mp4'}]
  }
 };
 const location={origin:'https://www.youtube.com',pathname:'/watch',search:'?v='+id};
 const window={ytInitialPlayerResponse:playerResponse,addEventListener:()=>{},postMessage:(p)=>sent.push(p)};
 const context={window,document:{title:'Test',addEventListener:()=>{}},location,
  URLSearchParams,URL,setInterval:()=>{},setTimeout:()=>{},clearTimeout:()=>{}};
 vm.runInNewContext(youtubeScript,context);
 assert.equal(sent.length,1);
 assert.equal(sent[0].payload.videoId,id);
 assert.equal(sent[0].payload.audioTracks,1);
 assert.equal(sent[0].payload.videoTracks,1);
 assert.equal(sent[0].payload.progressive.length,1);
 assert.equal(sent[0].payload.progressive[0].hasAudio,true);
});

test('YouTube page bridge does not carry stale player info across SPA navigation',()=>{
 const messages=[];
 const window={ytInitialPlayerResponse:{videoDetails:{videoId:'abcdefghijk',title:'Previous video'}} ,
  addEventListener:()=>{},postMessage:m=>messages.push(m)};
 vm.runInNewContext(youtubeScript,{window,document:{title:'Current',addEventListener:()=>{}},
  location:{origin:'https://www.youtube.com',pathname:'/watch',search:'?v=zzzzzzzzzzz'},
  URLSearchParams,URL,setInterval:()=>{},setTimeout:()=>{},clearTimeout:()=>{}});
 assert.equal(messages.length,0);
});
