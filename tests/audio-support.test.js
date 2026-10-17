import test from 'node:test';
import assert from 'node:assert/strict';
import {AUDIO_PROFILES,isAudioProfile,canExtractAudioFromVideo} from '../audio-support.js';

test('audio extraction supports curated real output types only',()=>{
 assert.deepEqual(AUDIO_PROFILES.map(v=>v.value),
  ['mp3-192','mp3-128','mp3-320','m4a','opus']);
 for(const profile of AUDIO_PROFILES)assert.ok(isAudioProfile(profile.value));
 for(const value of ['wav','mp3','mp4','mp3;echo hi','',null,undefined,320])
  assert.equal(isAudioProfile(value),false);
});
test('social video player is available for audio extraction without a preloaded segment',()=>{
 assert.equal(canExtractAudioFromVideo('https://www.instagram.com/',{type:'Player',url:'https://www.instagram.com/'}),true);
 assert.equal(canExtractAudioFromVideo('https://br.pinterest.com/',{type:'Player',url:'https://br.pinterest.com/'}),true);
 assert.equal(canExtractAudioFromVideo('https://www.youtube.com/watch?v=abcdefghijk',
  {type:'Player',url:'https://www.youtube.com/'}),true);
});
test('audio-only controls cannot be shown for unrelated or forged player origins',()=>{
 const item={type:'Player',url:'https://example.org/'};
 for(const page of ['https://example.org/','https://youtube.com.attacker.test/',
  'http://www.instagram.com/','https://www.youtube.com.evil.test/']){
  assert.equal(canExtractAudioFromVideo(page,item),false,page);
 }
});
test('direct HLS/MP4 audio extraction is available only for known origin/CDN pairs',()=>{
 assert.equal(canExtractAudioFromVideo('https://topanimes.net/assistir/episode/',{
  type:'HLS',url:'https://doce-de-leite-vegano.b-cdn.net/stream/episode.m3u8'
 }),true);
 assert.equal(canExtractAudioFromVideo('https://sushianimes.com.br/assistir/episode/',{
  type:'Video',url:'https://cdn-s01.pixel-sus-4k-image.com/stream/video.mp4'
 }),true);
 assert.equal(canExtractAudioFromVideo('https://example.org/',{
  type:'Video',url:'https://cdn-s01.pixel-sus-4k-image.com/stream/video.mp4'
 }),false);
 assert.equal(canExtractAudioFromVideo('https://topanimes.net/assistir/episode/',{
  type:'DASH',url:'https://doce-de-leite-vegano.b-cdn.net/episode.mpd'
 }),false);
});
