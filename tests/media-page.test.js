import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalMediaPageUrl,uniquePostUrl} from '../media-page.js';

test('Instagram Reel or post URLs are canonicalized',()=>{
 assert.equal(canonicalMediaPageUrl('https://www.instagram.com/reel/ABC123/?igsh=foo'),
  'https://www.instagram.com/reel/ABC123/');
 assert.equal(canonicalMediaPageUrl('https://instagram.com/p/CKx_y-Z/?utm_source=test'),
  'https://www.instagram.com/p/CKx_y-Z/');
});
test('Instagram feed, profiles and search are not video download targets',()=>{
 for(const url of ['https://www.instagram.com/','https://www.instagram.com/explore/',
  'https://www.instagram.com/user123/','https://www.instagram.com/reels/',
  'https://evil.instagram.com.evil.test/reel/ABC123/']){
  assert.equal(canonicalMediaPageUrl(url),null,url);
 }
});
test('YouTube video pages are normalized without secondary query params',()=>{
 assert.equal(canonicalMediaPageUrl('https://www.youtube.com/watch?v=abcdefghijk&t=42'),
  'https://www.youtube.com/watch?v=abcdefghijk');
 assert.equal(canonicalMediaPageUrl('https://youtu.be/abcdefghijk?t=15'),
  'https://www.youtube.com/watch?v=abcdefghijk');
 assert.equal(canonicalMediaPageUrl('https://m.youtube.com/shorts/abcdefghijk'),
  'https://www.youtube.com/watch?v=abcdefghijk');
});
test('YouTube homepage and search are rejected',()=>{
 for(const url of ['https://youtube.com/','https://youtube.com/results?search_query=cats',
  'https://youtube.com/watch?v=short','http://youtube.com/watch?v=abcdefghijk']){
  assert.equal(canonicalMediaPageUrl(url),null,url);
 }
});
test('a candidate is resolved only when there is exactly one unique matching post',()=>{
 assert.equal(uniquePostUrl(['https://instagram.com/p/ABC123/?utm_a=1',
  'https://instagram.com/p/ABC123/']),'https://www.instagram.com/p/ABC123/');
 assert.equal(uniquePostUrl(['https://instagram.com/p/ABC123/',
  'https://instagram.com/reel/XYZ123/']),null);
});

test('Pinterest Pin URL is accepted, while feed and profile are rejected',()=>{
 assert.equal(canonicalMediaPageUrl('https://br.pinterest.com/pin/123456789012345/?utm_medium=foo'),
  'https://www.pinterest.com/pin/123456789012345/');
 assert.equal(canonicalMediaPageUrl('https://www.pinterest.com/pin/123456789012345/'),
  'https://www.pinterest.com/pin/123456789012345/');
 for(const url of ['https://br.pinterest.com/','https://br.pinterest.com/user/',
  'https://pinterest.com/search/pins/?q=test',
  'https://pinterest.com/pin/notanumber/',
  'https://pinterest.com.evil.test/pin/123456789012345/']){
  assert.equal(canonicalMediaPageUrl(url),null,url);
 }
});
