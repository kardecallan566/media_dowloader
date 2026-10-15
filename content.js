// Discover media from DOM without requiring playback.
(()=>{
  const seen=new Set();
  function send(raw) {
    if(!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return;
    let url;
    try { url=new URL(raw,location.href); } catch { return; }
    if(!['http:','https:'].includes(url.protocol)||seen.has(url.href))return;
    if(!/\.(mp4|webm|mov|m4v|m3u8|mpd|mp3|m4a|aac)(?:$|[?#])/i.test(url.href))return;
    seen.add(url.href);
    chrome.runtime.sendMessage({cmd:'onMediaDetected',url:url.href,tabTitle:document.title}).catch(()=>{});
  }
  function scan(root=document) {
    if(!root.querySelectorAll)return;
    const nodes=root.querySelectorAll('video,audio,source,a[href],meta[property="og:video"],meta[property="og:video:url"],meta[name="twitter:player:stream"]');
    for(const node of nodes) {
      if(node.matches('a[href]'))send(node.getAttribute('href'));
      else if(node.matches('meta'))send(node.content);
      else { send(node.getAttribute('src')); if(node.currentSrc)send(node.currentSrc); }
    }
  }
  scan();
  let timer;
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>scan(),250)});
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','href','content']});
  document.addEventListener('loadstart',ev=>{if(ev.target?.currentSrc)send(ev.target.currentSrc)},true);
})();