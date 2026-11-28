// Revision notifications contain no business data. Clients re-read their authorized view.
export function createStockLive({version, authorize, intervalMs=3000}) {
  const clients=new Set(); let timer=null, busy=false;
  function remove(c){if(!clients.delete(c))return;c.res.end();if(!clients.size&&timer){clearInterval(timer);timer=null;}}
  function emit(c,updatedAt){
    if(c.res.destroyed)return remove(c);
    if(c.last!==updatedAt){c.last=updatedAt;if(!c.res.write(`event: revision\ndata: ${JSON.stringify({updatedAt})}\n\n`))remove(c);}
  }
  async function check(){
    if(busy||!clients.size)return;busy=true;
    try{const at=await version();for(const c of clients){
      try{await authorize(c.req);emit(c,at);if(!c.res.destroyed)c.res.write(': heartbeat\n\n');}catch{remove(c);}
    }}catch{/* Reconnect/polling retries; never announce an unconfirmed revision. */}finally{busy=false;}
  }
  return {
    connect(req,res){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'private, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.write('retry: 3000\n\n');const c={req,res,last:undefined};clients.add(c);res.on('close',()=>remove(c));
      if(!timer){timer=setInterval(check,intervalMs);timer.unref?.();}void check();
    },
    publish(updatedAt){for(const c of clients)emit(c,updatedAt);},
    close(){for(const c of [...clients])remove(c);}
  };
}
