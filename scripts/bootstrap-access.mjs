// Run once from the service shell after deploying access control.
// Receives account definitions on stdin; never writes plaintext passwords to disk.
import { initialAccess } from '../content-ops/access.js';
import { randomUUID } from 'node:crypto';
const url=process.env.SUPABASE_URL?.replace(/\/$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw Error('Supabase configuration is required');
const id=process.env.CONTENT_OPS_STATE_ID||'default';
async function request(path,options={}){
 const r=await fetch(`${url}/rest/v1${path}`,{...options,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...options.headers}});
 if(!r.ok)throw Error(`Database request failed (${r.status})`);const text=await r.text();return text?JSON.parse(text):null;
}
let input=''; for await (const chunk of process.stdin) input+=chunk;
const definitions=JSON.parse(input);
const rows=await request(`/content_ops_state?id=eq.${encodeURIComponent(id)}&select=state,updated_at`);
const row=rows?.[0];if(!row?.state)throw Error('Existing operations data was not found; refusing to initialize over empty data');
if(row.state._access)throw Error('Login accounts already exist; use the administrator account management page');
const ids=new Set(row.state.accounts.map(a=>a.id));for(const user of definitions)if((user.accountIds||[]).some(value=>!ids.has(value)))throw Error('An assigned content account does not exist');
const at=new Date(Math.max(Date.now(),Date.parse(row.state.updatedAt)+1)).toISOString();
const next={...row.state,_access:await initialAccess(definitions),_audit:[...(row.state._audit||[]),{id:randomUUID(),at,actor:{username:'system',name:'系统'},device:'服务器',clientId:'bootstrap',event:'启用独立登录账号与修改历史',entries:[]}],updatedAt:at};
await request('/content_ops_state?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({id:`${id}-history-${row.state.updatedAt}`,state:row.state,updated_at:row.state.updatedAt})});
const saved=await request(`/content_ops_state?id=eq.${encodeURIComponent(id)}&updated_at=eq.${encodeURIComponent(row.updated_at)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({state:next,updated_at:at})});
if(!saved?.length)throw Error('The data changed during setup; no accounts were initialized. Read the latest data and retry.');
console.log(JSON.stringify({ok:true,users:next._access.users.map(u=>({username:u.username,role:u.role,accountIds:u.accountIds})),postsPreserved:next.posts.length,updatedAt:at}));
