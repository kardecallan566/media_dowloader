import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../popup.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../popup.js',import.meta.url),'utf8');

test('header displays the new playlist action next to refresh and clear controls',()=>{
 const header=html.slice(html.indexOf('<header>'),html.indexOf('</header>'));
 assert.ok(header.indexOf('id="playlistToggle"')>0);
 assert.ok(header.indexOf('id="playlistToggle"')<header.indexOf('id="refresh"'));
 assert.ok(header.indexOf('id="refresh"')<header.indexOf('id="clear"'));
 assert.match(header,/aria-controls="playlistTool" aria-expanded="false"/);
 assert.match(header,/<svg[^>]*>[\s\S]*?<path[^>]*>/);
});

test('playlist editor remains hidden until opened and no longer occupies main screen',()=>{
 assert.match(html,/<div id="playlistBackdrop"[^>]* hidden><\/div>/);
 assert.match(html,/<section id="playlistTool" class="playlist-tool" role="dialog" aria-modal="true"[\s\S]*?hidden>/);
 assert.doesNotMatch(html,/<details id="playlistTool"/);
 assert.ok(html.indexOf('id="playlistTool"')<html.indexOf('<nav class="tabs"'));
 assert.match(html,/\[hidden\]\{display:none!important\}/);
});

test('dialog supports closing, keyboard navigation and active-download indicator',()=>{
 for(const needed of [
  'function openPlaylistPanel()', 'function closePlaylistPanel()',
  "playlistEls.toggle.onclick=", "playlistEls.close.onclick=closePlaylistPanel",
  "playlistEls.backdrop.onclick=closePlaylistPanel",
  "event.key==='Escape'", "event.key!=='Tab'",
  "playlistEls.toggle.dataset.status=indicator",
  "playlistEls.toggle.setAttribute('aria-label',label)"
 ])assert.ok(script.includes(needed),needed);
 assert.doesNotMatch(script,/playlistEls\.tool\.open\s*=/);
 assert.match(script,/\['connecting','running','canceling'\]/);
});

test('playlist fields preserve safe canonical URL and format across popup reopening, not cookies',()=>{
 assert.match(script,/playlistFormDraft:\s*\{\s*url,format:playlistEls\.format\.value/);
 assert.match(script,/youtubePlaylistUrl\(playlistEls\.url\.value\)/);
 assert.match(script,/chrome\.storage\.local\.get\((?:'playlistFormDraft'|\['playlistFormDraft')/);
 assert.ok(!script.includes('cookies:playlistEls.cookies.value'));
 assert.ok(!script.includes('playlistCookies:playlistEls.cookies.value'));
 assert.match(script,/const activePlaylist=youtubePlaylistUrl\(tabUrl\)/);
});

test('playlist feature keeps independent batch start and cancel commands intact',()=>{
 assert.match(script,/cmd:'startPlaylistAudio'/);
 assert.match(script,/cmd:'cancelPlaylistAudio'/);
 assert.match(script,/cmd:'getPlaylistAudioJob'/);
 assert.match(html,/id="playlistUrl"/);
 assert.match(html,/id="playlistFormat"/);
 assert.match(html,/id="playlistCookies"/);
 assert.match(html,/id="playlistCancel"/);
 assert.match(html,/id="playlistProgress"/);
});
