import { randomBytes, randomUUID, scrypt as derive, createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
const cookieName = 'content_ops_session_v2';
const fail = (status, message) => Object.assign(new Error(message), { status });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const safe = value => String(value || '').trim().slice(0,100);
const stockRoles = new Set(['none','viewer','warehouse','operations','marketing','customer_service','pr','content','pr_service','finance']);
const stockRole = value => stockRoles.has(value) ? value : 'none';
export function publicUser(user) {
  const { id, username, name, role, accountIds, disabled } = user;
  return { id, username, name, role, accountIds, stockRole:stockRole(user.stockRole), scopeVersion:user.sessionVersion, disabled: Boolean(disabled) };
}
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 256) throw fail(400,'密码需要6至256个字符');
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password,salt,32)).toString('hex')}`;
}
async function passwordMatches(password, hash) {
  const [salt, encoded] = String(hash || '').split(':');
  if (!salt || !encoded || typeof password !== 'string' || password.length > 256) return false;
  const value = await scrypt(password,salt,32), expected=Buffer.from(encoded,'hex');
  return expected.length === value.length && timingSafeEqual(value,expected);
}
export async function initialAccess(users) {
  if (!Array.isArray(users) || !users.some(u=>u.role==='admin')) throw fail(400,'至少需要一个管理员');
  const result=[];
  for (const item of users) {
    const username=safe(item.username).toLowerCase();
    if (!/^[a-z0-9_-]{3,40}$/.test(username) || result.some(u=>u.username===username)) throw fail(400,'登录名格式不正确或重复');
    result.push({id:randomUUID(),username,name:safe(item.name)||username,role:item.role==='admin'?'admin':'employee',stockRole:stockRole(item.stockRole),accountIds:[...new Set(item.accountIds||[])],passwordHash:await passwordHash(item.password),sessionVersion:1,disabled:false});
  }
  return { sessionSecret:randomBytes(32).toString('hex'), users:result };
}
export function publicState(state,user) {
  const { _access, _audit, ...visible } = state;
  if (user.role==='admin') return visible;
  const ids=new Set(user.accountIds||[]);
  return {...visible,accounts:visible.accounts.filter(a=>ids.has(a.id)),posts:visible.posts.filter(p=>ids.has(p.accountId))};
}
export function scopedWrite(current,incoming,user) {
  if (user.role==='admin') return incoming;
  const ids=new Set(user.accountIds||[]), allowed=publicState(current,user);
  // Shared libraries and channel assignments are managed by the administrator.
  for (const key of ['accounts','titles','products','inventorySettings']) {
    if (!same(incoming[key],allowed[key])) throw fail(403,'只有管理员可以修改账号设置、标题库或产品库');
  }
  const hiddenIds=new Set(current.posts.filter(p=>!ids.has(p.accountId)).map(p=>p.id));
  for (const post of incoming.posts) {
    if (!ids.has(post.accountId) || hiddenIds.has(post.id)) throw fail(403,'不能修改未分配给你的内容账号');
  }
  return {...current,posts:[...current.posts.filter(p=>!ids.has(p.accountId)),...incoming.posts]};
}
export function validateRows(state) {
  for (const key of ['posts','accounts','titles','products']) {
    const rows=state[key]||[];
    if (!Array.isArray(rows) || rows.some(r=>!r || typeof r.id!=='string' || !r.id) || new Set(rows.map(r=>r.id)).size!==rows.length) throw fail(400,`${key}包含无效或重复记录`);
  }
  const accounts=new Set(state.accounts.map(a=>a.id));
  if (state.posts.some(p=>p.accountId && !accounts.has(p.accountId))) throw fail(400,'发布记录的所属账号不存在');
}
export function changeEntries(before,after) {
  const entries=[];
  for (const collection of ['posts','accounts','titles','products']) {
    const old=new Map((before?.[collection]||[]).map(r=>[r.id,r]));const next=new Map((after?.[collection]||[]).map(r=>[r.id,r]));
    for (const id of new Set([...old.keys(),...next.keys()])) {
      const a=old.get(id),b=next.get(id);const fields={};
      for (const field of new Set([...Object.keys(a||{}),...Object.keys(b||{})])) {
        if (['updatedAt','clientUpdatedAt'].includes(field)) continue;
        if (!same(a?.[field],b?.[field])) fields[field]={before:a?.[field]??null,after:b?.[field]??null};
      }
      if (Object.keys(fields).length) entries.push({collection,id,accountId:collection==='accounts'?id:(b?.accountId||a?.accountId||null),previousAccountId:a?.accountId||null,title:b?.headline||a?.headline||b?.name||a?.name||b?.title||a?.title||id,action:!a?'新增':!b?'删除':'修改',fields});
    }
  }
  if (!same(before?.inventorySettings,after?.inventorySettings)) entries.push({collection:'inventorySettings',id:'inventory',accountId:null,title:'库存连接设置',action:'修改',fields:{inventorySettings:{before:before?.inventorySettings,after:after?.inventorySettings}}});
  return entries;
}
export function makeAudit(current,next,options) {
  const entries=changeEntries(current,next);
  if (!entries.length && !options.event) return null;
  const ua=String(options.userAgent||'').slice(0,300);
  return {id:randomUUID(),at:next.updatedAt,actor:options.actor?{id:options.actor.id,username:options.actor.username,name:options.actor.name}: {username:'system',name:'系统'},device:/iPad|Tablet/i.test(ua)?'iPad/平板':/iPhone|Android/i.test(ua)?'手机':'电脑',clientId:String(options.clientId||'').slice(0,100),event:options.event||'保存内容',entries};
}
export function createAccessControl({read,write,readAccess}) {
  const attempts=new Map();
  async function stateWithAccess() {
    let state=await (readAccess ? readAccess() : read());
    if (state._access) return state;
    const config=process.env.CONTENT_OPS_INITIAL_USERS;
    if (!config) throw fail(503,'管理员登录账号尚未初始化，请联系管理员');
    state=await read();
    if (state._access) return state;
    try {return await write({...state,_access:await initialAccess(JSON.parse(config))},{system:true,expectedUpdatedAt:state.updatedAt,event:'初始化登录账号'});}
    catch(error){if(error.status===409)return stateWithAccess();throw error;}
  }
  function issueCookie(request,state,user) {
    const encoded=Buffer.from(JSON.stringify({id:user.id,version:user.sessionVersion,expires:Date.now()+7*86400000})).toString('base64url');
    const signature=createHmac('sha256',state._access.sessionSecret).update(encoded).digest('hex');
    const secure=request.headers['x-forwarded-proto']==='https'||request.socket.encrypted;
    return `${cookieName}=${encoded}.${signature}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure?'; Secure':''}`;
  }
  async function requireUser(request) {
    const state=await stateWithAccess();
    const cookie=String(request.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if (!cookie) throw fail(401,'请先登录');
    const [encoded,signature]=cookie.split('.');
    const expected=createHmac('sha256',state._access.sessionSecret).update(encoded||'').digest('hex');
    if (!signature || signature.length!==expected.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) throw fail(401,'登录已失效，请重新登录');
    let payload;try{payload=JSON.parse(Buffer.from(encoded,'base64url').toString())}catch{throw fail(401,'登录已失效')}
    const user=state._access.users.find(u=>u.id===payload.id&&!u.disabled&&u.sessionVersion===payload.version);
    if (!user || !Number.isFinite(payload.expires) || payload.expires<Date.now()) throw fail(401,'登录已失效，请重新登录');
    return user;
  }
  function checkOrigin(request) {
    const origin=request.headers.origin;
    if (origin && new URL(origin).host!==request.headers.host) throw fail(403,'不允许跨网站访问');
    if (request.headers['sec-fetch-site']==='cross-site') throw fail(403,'不允许跨网站访问');
    if (['POST','PUT','PATCH','DELETE'].includes(request.method) && !String(request.headers['content-type']||'').startsWith('application/json')) throw fail(415,'请使用JSON请求');
  }
  async function handle(request,response,url,send,body) {
    if (!url.pathname.startsWith('/api/content-ops/')) return false;
    checkOrigin(request);
    const headers={'Cache-Control':'no-store'};
    if (url.pathname==='/api/content-ops/login' && request.method==='POST') {
      const payload=JSON.parse(await body(request));const username=safe(payload.username).toLowerCase();const now=Date.now();
      for(const [key,a]of attempts)if(a.until<=now)attempts.delete(key);
      const key=`${request.socket.remoteAddress}:${username}`,entry=attempts.get(key)||{count:0,until:now+600000};
      if (entry.count>=15) throw fail(429,'尝试次数过多，请10分钟后重试');
      if(attempts.size>1000)throw fail(429,'登录繁忙，请稍后重试');
      entry.count++;attempts.set(key,entry);
      const state=await stateWithAccess(),user=state._access.users.find(u=>u.username===username&&!u.disabled);
      if (!user || !await passwordMatches(payload.password,user.passwordHash)) throw fail(401,'账号或密码不正确');
      attempts.delete(key);send(response,200,{user:publicUser(user)},{...headers,'Set-Cookie':issueCookie(request,state,user)});return true;
    }
    if (url.pathname==='/api/content-ops/logout' && request.method==='POST') {
      send(response,200,{ok:true},{...headers,'Set-Cookie':`${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`});return true;
    }
    const user=await requireUser(request);request.contentOpsUser=user;
    if (url.pathname==='/api/content-ops/session' && request.method==='GET') {send(response,200,{user:publicUser(user)},headers);return true;}
    if (url.pathname==='/api/content-ops/users') {
      if (user.role!=='admin') throw fail(403,'仅管理员可以管理登录账号');
      if (request.method==='GET'){const current=await stateWithAccess();send(response,200,{users:current._access.users.map(publicUser)},headers);return true;}
      if (request.method!=='POST')throw fail(405,'Method not allowed');
      // Authentication may read only the private access projection. A membership
      // write must retain the complete business state and its current version.
      const current=await read();
      const payload=JSON.parse(await body(request));const users=structuredClone(current._access.users);
      const target=payload.id?users.find(u=>u.id===payload.id):null;
      if (payload.id&&!target)throw fail(404,'登录账号不存在');
      const username=safe(payload.username).toLowerCase();
      if (!/^[a-z0-9_-]{3,40}$/.test(username)||users.some(u=>u.username===username&&u.id!==target?.id))throw fail(400,'登录名格式不正确或已存在');
      if (!Array.isArray(payload.accountIds)) throw fail(400,'负责的内容账号格式不正确');
      const role=payload.role==='admin'?'admin':'employee',accountIds=[...new Set(payload.accountIds)];
      if (accountIds.some(id=>!current.accounts.some(a=>a.id===id)))throw fail(400,'负责的内容账号不存在');
      const updated={...target,id:target?.id||randomUUID(),username,name:safe(payload.name)||username,role,stockRole:payload.stockRole===undefined?stockRole(target?.stockRole):stockRole(payload.stockRole),accountIds,disabled:Boolean(payload.disabled),sessionVersion:(target?.sessionVersion||0)+1};
      updated.passwordHash=payload.password?await passwordHash(payload.password):target?.passwordHash;
      if (!updated.passwordHash)throw fail(400,'新增账号需要设置密码');
      if (target)users[users.indexOf(target)]=updated;else users.push(updated);
      if (!users.some(u=>u.role==='admin'&&!u.disabled))throw fail(400,'至少保留一个启用的管理员');
      const saved=await write({...current,_access:{...current._access,users}},{system:true,actor:user,expectedUpdatedAt:current.updatedAt,event:`${target?'修改':'新增'}登录账号 ${username}`,userAgent:request.headers['user-agent']});
      const h={...headers};if(updated.id===user.id)h['Set-Cookie']=issueCookie(request,saved,updated);
      send(response,200,{users:users.map(publicUser),user:publicUser(updated)},h);return true;
    }
    if(url.pathname==='/api/content-ops/history'&&request.method==='GET'){
      const state=await read(),ids=new Set(user.accountIds||[]),before=url.searchParams.get('before'),accountId=url.searchParams.get('accountId');
      let items=(state._audit||[]).slice().reverse();
      if(before){const index=items.findIndex(e=>e.id===before);items=index<0?[]:items.slice(index+1)}
      items=items.map(item=>({...item,entries:item.entries.filter(e=>user.role==='admin'||(ids.has(e.accountId)&&(!e.previousAccountId||ids.has(e.previousAccountId))))})).filter(item=>user.role==='admin'||item.entries.length);
      if(accountId)items=items.filter(item=>item.entries.some(e=>e.accountId===accountId));
      const page=items.slice(0,50);send(response,200,{items:page,next:items.length>50?page.at(-1).id:null},headers);return true;
    }
    return false;
  }
  return {handle,requireUser};
}
