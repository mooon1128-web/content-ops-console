// Shared data and application versions must never fall back to stale offline pages.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('content-ops-app-'))await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/')||event.request.method!=='GET')return;
  event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>new Response(
    event.request.mode==='navigate'?'<!doctype html><meta charset="utf-8"><h1>暂时未连接到共享服务器</h1><p>请联网后重新打开。这里不会显示过期的本机数据。</p><button onclick="location.reload()">重新连接</button>':'',
    {status:503,headers:{'Content-Type':event.request.mode==='navigate'?'text/html; charset=utf-8':'text/plain','Cache-Control':'no-store'}})));
});
