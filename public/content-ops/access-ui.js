(() => {
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let bridge, user, historyCursor=null, historyAccount='',viewVersion=0;
  const fieldNames={scheduledAt:'计划发布时间',publishedAt:'实际发布时间',shootingAt:'拍摄时间',headline:'标题',status:'发布状态',accountId:'所属内容账号',owner:'负责人',shootingPlan:'拍摄计划',notes:'备注',platformMetrics:'平台数据',progressPlanning:'策划进度',progressShooting:'拍摄进度',progressEditing:'制作进度',progressTitle:'标题进度',progressAccount:'账号进度',frequencyPerWeek:'每周频率',inventorySettings:'库存设置',name:'名称'};
  const textValue = value => value === null ? '（空）' : typeof value==='object' ? JSON.stringify(value,null,2) : String(value);
  async function request(path, options={}) {
    const response=await fetch('/api/content-ops/'+path,{cache:'no-store',...options,headers:{'Content-Type':'application/json',...options.headers}});
    const result=await response.json();
    if(!response.ok){if(response.status===401)expired();throw Error(result.error||'请求失败')}
    return result;
  }
  function message(text){$('#access-message').textContent=text}
  function expired(){
    bridge?.pause();user=null;document.body.classList.add('signed-out');$('#login-layer').hidden=false;$('#login-message').textContent='请登录，未同步修改会保留在原账号下。';
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  }
  async function signedIn(value){
    if(['warehouse','customer_service','pr','pr_service'].includes(value.stockRole)){location.replace('/stock-ops/');return;}
    user=value;$('#login-layer').hidden=true;document.body.classList.remove('signed-out');document.body.dataset.role=user.role;
    $('#signed-in-name').textContent=`${user.name} · ${user.username}${user.role==='admin'?' · 管理员':''}`;
    $('#users-tab').hidden=user.role!=='admin';
    await bridge.activate(user);
  }
  async function connect(value){
    bridge=value;
    $('#login-form').addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
      try{const data=Object.fromEntries(new FormData(form));const result=await request('login',{method:'POST',body:JSON.stringify(data)});form.reset();await signedIn(result.user)}
      catch(error){$('#login-message').textContent=error.message}finally{button.disabled=false}
    });
    $('#sign-out').addEventListener('click',async()=>{
      if(bridge.pending()&&!confirm('有未同步修改，已保留在此账号本机。退出后需要重新登录此账号继续同步，是否退出？'))return;
      try{await request('logout',{method:'POST',body:'{}'});expired();$('#login-message').textContent='已退出登录'}catch(error){bridge.notify(error.message)}
    });
    $('#open-access').addEventListener('click',async()=>{$('#access-dialog').showModal();historyAccount='';await openHistory()});
    $('#access-close').addEventListener('click',()=>{$('#access-dialog').close();bridge.refresh()});
    $('#history-tab').addEventListener('click',()=>openHistory());
    $('#users-tab').addEventListener('click',()=>openUsers());
    try{await signedIn((await request('session')).user)}catch(error){expired();$('#login-message').textContent=error.message==='请先登录'?'请输入你的登录账号和密码':error.message}
  }
  async function openHistory(append=false){
    const view=++viewVersion;
    try{
      $('#history-tab').classList.add('active');$('#users-tab').classList.remove('active');
      if(!append){historyCursor=null;const accounts=bridge.accounts();$('#access-content').innerHTML=`<div class="access-toolbar"><label>内容账号<select id="history-account"><option value="">全部可查看账号</option>${accounts.map(a=>`<option value="${escape(a.id)}" ${historyAccount===a.id?'selected':''}>${escape(a.name)}</option>`).join('')}</select></label><button type="button" id="history-refresh" class="secondary-button">刷新记录</button></div><p class="row-meta">记录从本次升级后开始；可查看每次保存的人、设备，以及修改前后的内容。</p><div id="history-items"></div><button type="button" class="secondary-button" id="history-more" hidden>更早记录</button>`;
        $('#history-account').onchange=()=>{historyAccount=$('#history-account').value;openHistory()};$('#history-refresh').onclick=()=>openHistory();$('#history-more').onclick=()=>openHistory(true);
      }
      const params=new URLSearchParams();if(historyAccount)params.set('accountId',historyAccount);if(append&&historyCursor)params.set('before',historyCursor);
      const result=await request('history?'+params);if(view!==viewVersion)return;
      const html=result.items.map(item=>`<article class="history-entry"><div class="history-heading"><strong>${escape(item.actor.name)} (${escape(item.actor.username)})</strong><span>${escape(item.device)} · ${escape(new Date(item.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))}</span></div><p>${escape(item.event)}</p>${item.entries.map(e=>`<details><summary>${escape(e.action)} · ${escape(e.title)}</summary><dl>${Object.entries(e.fields).map(([key,change])=>`<div><dt>${escape(fieldNames[key]||key)}</dt><dd><span>修改前</span><pre>${escape(textValue(change.before))}</pre><span>修改后</span><pre>${escape(textValue(change.after))}</pre></dd></div>`).join('')}</dl></details>`).join('')}</article>`).join('');
      if(append)$('#history-items').insertAdjacentHTML('beforeend',html);else $('#history-items').innerHTML=html||'<p class="empty">暂无修改记录。新保存的操作会出现在这里。</p>';
      historyCursor=result.next;$('#history-more').hidden=!historyCursor;message('');
    }catch(error){message(error.message)}
  }
  async function openUsers(editing){
    if(user.role!=='admin')return;
    const view=++viewVersion;
    try{
      $('#users-tab').classList.add('active');$('#history-tab').classList.remove('active');const result=await request('users'),accounts=bridge.accounts();if(view!==viewVersion)return;
      $('#access-content').innerHTML=`<p class="row-meta">管理员可查看全部内容与修改历史。员工只可查看、编辑分配给自己的内容账号。</p><div class="login-users">${result.users.map(u=>`<article><strong>${escape(u.name)} · ${escape(u.username)}</strong><span>${u.role==='admin'?'管理员':(u.accountIds||[]).map(id=>accounts.find(a=>a.id===id)?.name||id).join('、')||'未分配内容账号'}${u.disabled?' · 已停用':''}</span><button type="button" data-user-edit="${escape(u.id)}" class="secondary-button small">编辑</button></article>`).join('')}</div><form id="login-user-form" class="access-user-form"><h3>${editing?'修改登录账号':'新增登录账号'}</h3><label>登录名<input name="username" autocomplete="off" required pattern="[a-zA-Z0-9_-]{3,40}" value="${escape(editing?.username||'')}" /></label><label>姓名<input name="name" required value="${escape(editing?.name||'')}" /></label><label>密码<input name="password" type="password" autocomplete="new-password" minlength="6" ${editing?'':'required'} placeholder="${editing?'留空则保留原密码':'至少6位'}" /></label><label>角色<select name="role"><option value="employee">员工</option><option value="admin" ${editing?.role==='admin'?'selected':''}>管理员</option></select></label><fieldset><legend>负责的内容账号</legend>${accounts.map(a=>`<label class="assignment-check"><input type="checkbox" name="accountIds" value="${escape(a.id)}" ${editing?.accountIds.includes(a.id)?'checked':''}/>${escape(a.name)}</label>`).join('')}</fieldset><label class="assignment-check"><input type="checkbox" name="disabled" ${editing?.disabled?'checked':''}/>停用此登录账号</label><div><button class="primary-button" type="submit">保存登录账号</button> <button class="secondary-button" id="new-login-user" type="button">新增另一个</button></div></form>`;
      for(const button of document.querySelectorAll('[data-user-edit]'))button.onclick=()=>openUsers(result.users.find(u=>u.id===button.dataset.userEdit));
      $('#new-login-user').onclick=()=>openUsers();
      $('#login-user-form').onsubmit=async event=>{
        event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;
        try{const data=new FormData(form),payload={...Object.fromEntries(data),accountIds:data.getAll('accountIds'),disabled:data.has('disabled')};if(editing)payload.id=editing.id;await request('users',{method:'POST',body:JSON.stringify(payload)});message('登录账号已保存，权限变更后需重新登录。');await openUsers();bridge.refresh()}
        catch(error){message(error.message)}finally{button.disabled=false}
      };message('');
    }catch(error){message(error.message)}
  }
  globalThis.ContentOpsAccess={connect,expired};
})();
