import test from 'node:test';
import assert from 'node:assert/strict';
import {youtubePlaylistUrl} from '../youtube-playlist.js';

test('pasted YouTube playlist and watch-with-list normalize to a playlist URL',()=>{
 assert.equal(youtubePlaylistUrl('https://www.youtube.com/playlist?list=PLabcdefghijklmnop&si=abc'),
  'https://www.youtube.com/playlist?list=PLabcdefghijklmnop');
 assert.equal(youtubePlaylistUrl('https://m.youtube.com/watch?v=abcdefghijk&list=PLabcdefghijklmnop&index=6'),
  'https://www.youtube.com/playlist?list=PLabcdefghijklmnop');
});
test('mix playlists, redirects, arbitrary hosts and ordinary video URLs are rejected',()=>{
 for(const url of [
  'https://youtube.com/watch?v=abcdefghijk',
  'https://www.youtube.com/',
  'https://youtu.be/abcdefghijk?list=PLabcdefghijklmnop',
  'https://youtube.com.evil.test/playlist?list=PLabcdefghijklmnop',
  'http://youtube.com/playlist?list=PLabcdefghijklmnop',
  'https://user:pass@youtube.com/playlist?list=PLabcdefghijklmnop',
  'https://youtube.com:8080/playlist?list=PLabcdefghijklmnop',
  'https://youtube.com/playlist?list=short',
  'https://youtube.com/playlist?list=PLabcdefghijklmnop&list=PLotherplaylistxx',
  'javascript:alert(1)',
  'https://youtube.com/redirect?list=PLabcdefghijklmnop'
 ])assert.equal(youtubePlaylistUrl(url),null,url);
});
