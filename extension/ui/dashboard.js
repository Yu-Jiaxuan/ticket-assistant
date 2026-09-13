'use strict';
const $=s=>document.querySelector(s),C=TicketCatalog;
const inExtension=location.protocol==='chrome-extension:';
let draftId=null,saving=false;
let catalog=[],tasks=[],examples=false,selected=null,sim=null,simTimer=null;
const stateNames={upcoming:'尚未开售','time-unknown':'待开售 · 时间待核实',unknown:'开售状态待核实',stale:'信息过期 · 需重新采集',elapsed:'开售时间已过 · 余票未知'};
function tell(s){$('#feedback').textContent=s;}
function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function time(t){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short',hour12:false}).format(t);}
function inputTime(t){return new Date(t+8*3600000).toISOString().slice(0,19);}
async function read(){return inExtension?await chrome.storage.local.get(['catalog','tasks','lastCapture','activity']):JSON.parse(localStorage.getItem('ticket-ui-preview')||'{}');}
async function send(message){if(!inExtension)throw Error('当前是界面预览，请安装扩展后使用真实采集和提醒');const r=await chrome.runtime.sendMessage(message);if(!r?.ok)throw Error(r?.error||'操作没有完成');return r;}
function guard(fn){return async(...args)=>{try{await fn(...args);}catch(e){tell(e.message);}};}
async function refresh(){const data=await read();if(!examples)catalog=data.catalog||[];tasks=data.tasks||[];$('#capture-info').textContent=data.lastCapture?'最近采集 '+time(data.lastCapture.at):'还没有采集记录';renderEvents();renderTasks();}
function renderEvents(){
 const now=Date.now(),q=$('#search').value.toLowerCase(),filter=$('#filter').value;
 const list=catalog.filter(e=>(e.title+' '+e.city).toLowerCase().includes(q)&&(filter==='all'||C.status(e,now)===filter)).sort((a,b)=>$('#sort').value==='capture'?b.capturedAt-a.capturedAt:(a.opensAt||Infinity)-(b.opensAt||Infinity));
 $('#count').textContent=`${list.length} 场${examples?'虚构演出（仅演示）':'已收集演出'}`;$('#data-mode').textContent=examples?'当前为演示数据，不会写入真实列表':'';
 $('#events').replaceChildren();
 if(!list.length){const e=element('div',undefined,'empty');e.append(element('strong',catalog.length?'这个筛选下还没有演出':'还没有收集到演出'),element('p','先打开大麦搜索或演出详情页。页面加载出信息后会自动收集；未读取到的开售时间会保留为“待核实”，不会拿演出日期代替。'));$('#events').append(e);return;}
 for(const item of list){const card=element('article',undefined,'card'+(selected?.id===item.id?' selected':''));const art=element('div',undefined,'card-art');art.append(element('span',examples?'虚构样例':item.city||'演出现场','chip'),element('b','♫'));const body=element('div',undefined,'card-body');body.append(element('h3',item.title),element('p',stateNames[C.status(item,now)]),element('p',item.opensAt?'开售 '+time(item.opensAt)+'（北京时间）':'开售时间：暂未读取到'));const button=element('button','选择并设置备选');button.onclick=()=>choose(item);body.append(button);card.append(art,body);$('#events').append(card);}
}
function choose(item){if(C.selectionChanged(draftId,item.id)){$('#choices').replaceChildren();addChoice();}draftId=item.id;selected=item;$('#url').value=examples?'':item.url;$('#title').value=item.title;$('#opens').value=item.opensAt?inputTime(item.opensAt):'';$('#selected-title').textContent=item.title;$('#save').disabled=examples;if(examples)tell('已选虚构演出，可演练流程；不能创建真实提醒。');else tell('已选演出。请对照官方页面填写具体场次、票档并核实开售时间。');renderEvents();}
function addChoice(session='',tier=''){
 if($('#choices').children.length>=10)return tell('最多添加10个备选');
 const row=element('div',undefined,'choice');const rank=element('span','','rank'),s=element('input'),t=element('input'),up=element('button','↑'),del=element('button','×');s.placeholder='场次，例如 周六19:30';t.placeholder='票档，例如 680元';s.value=session;t.value=tier;s.required=t.required=true;s.maxLength=100;t.maxLength=60;s.setAttribute('aria-label','场次');t.setAttribute('aria-label','票档');up.type=del.type='button';up.title='上移优先级';del.title='删除备选';up.onclick=()=>{if(row.previousElementSibling)row.parentElement.insertBefore(row,row.previousElementSibling);ranks();};del.onclick=()=>{if($('#choices').children.length>1){row.remove();ranks();}};row.append(rank,s,t,up,del);$('#choices').append(row);ranks();
}
function ranks(){[...$('#choices').children].forEach((r,i)=>r.firstChild.textContent=String(i+1).padStart(2,'0'));}
function choices(){return [...$('#choices').children].map(r=>({session:r.querySelectorAll('input')[0].value.trim(),tier:r.querySelectorAll('input')[1].value.trim()}));}
function renderTasks(){
 $('#task-list').replaceChildren();if(!tasks.length){$('#task-list').append(element('p','还没有提醒计划。选择演出并保存后，会出现在这里。','hint'));return;}
 for(const t of tasks){const row=element('div',undefined,'task'),info=element('div');info.append(element('h3',t.title),element('p',`${t.quantity} 张 · 总价上限 ¥${(t.maxTotal/100).toFixed(2)} · ${t.choices.length} 个选择`));const a=element('a','打开官方演出');a.href=C.itemURL(t.url)?.url||'#';a.target='_blank';a.rel='noopener noreferrer';info.append(a);const status=element('strong','');status.dataset.taskId=t.taskId;const b=element('button',t.state==='scheduled'?'取消提醒':'已结束','secondary');b.disabled=t.state!=='scheduled';b.onclick=guard(async()=>{await send({type:'CANCEL',taskId:t.taskId});await refresh();});if(t.state==='notification-failed'){const retry=element('button','重试通知','secondary');retry.onclick=guard(async()=>{await send({type:'RETRY_NOTIFICATION',taskId:t.taskId});await refresh();});info.append(retry);}row.append(info,status,b);$('#task-list').append(row);}countdowns();
}
function countdowns(){for(const e of document.querySelectorAll('[data-task-id]')){const t=tasks.find(t=>t.taskId===e.dataset.taskId);const secs=Math.max(0,Math.ceil((t.opensAt-Date.now())/1000));e.textContent=t.state==='cancelled'?'已取消':t.state==='notified'?'通知已提交系统':t.state==='notification-failed'?'通知失败，请检查权限':t.state==='notification-unknown'?'通知结果不明，请人工核对':t.state==='notifying'?'正在提交系统通知':t.state==='schedule-failed'?'定时器创建失败':secs?`${Math.floor(secs/86400)}天 ${Math.floor(secs/3600)%24}时 ${Math.floor(secs/60)%60}分 ${secs%60}秒`:'等待系统提醒';}}
$('#open-search').onclick=()=>window.open('https://search.damai.cn/search.htm','_blank','noopener');
$('#scan').onclick=guard(async()=>{examples=false;selected=null;$('#save').disabled=false;const r=await send({type:'SCAN'});await refresh();tell(`已观察 ${r.count} 个官方页面，${r.failed||0} 个页面访问失败。只采集已加载的数据。`);});
for(const id of ['search','filter','sort'])$('#'+id).oninput=renderEvents;
$('#examples').onclick=async()=>{examples=!examples;selected=null;$('#save').disabled=examples;$('#examples').textContent=examples?'返回真实采集列表':'用虚构演出看看界面';if(examples){const now=Date.now();catalog=['【北京】月光现场 · 虚构演唱会','【上海】周末爵士 · 虚构音乐会','【广州】夏末回响 · 虚构演出'].map((title,i)=>({id:'demo-'+i,title,city:['北京','上海','广州'][i],opensAt:now+(i+1)*3600000,capturedAt:now,source:'demo'}));renderEvents();}else await refresh();};
$('#clear').onclick=guard(async()=>{await send({type:'CLEAR_CATALOG'});examples=false;await refresh();tell('已清空采集列表；购票计划保留。');});
$('#add-choice').onclick=()=>addChoice();
$('#plan-form').onsubmit=guard(async event=>{event.preventDefault();if(examples)throw Error('虚构演出不能创建真实提醒');const raw={url:$('#url').value,title:$('#title').value,opensAt:$('#opens').value,quantity:$('#quantity').value,maxTotal:$('#budget').value,choices:choices()};C.plan(raw);if(saving)return;saving=true;$('#save').disabled=true;try{const result=await send({type:'SAVE_PLAN',plan:raw});tell(result.duplicate?'相同计划已存在，没有重复创建。':'已保存提醒；系统通知可能延迟，不会自动下单。');await refresh();}finally{saving=false;$('#save').disabled=examples;}});
function runState(s){$('#run-state').textContent=s;$('#run-log').textContent+=new Date().toLocaleTimeString()+' '+s+'\n';}
function simJournal(){return JSON.parse(localStorage.getItem('ticket-ui-sim')||'{"phase":"IDLE"}');}
$('#run').onclick=guard(async()=>{
 if(simTimer)throw Error('演练正在运行');const list=choices();if(list.some(c=>!c.session||!c.tier))throw Error('请先填写场次与票档');
 const qty=Number($('#quantity').value),budget=C.money($('#budget').value),now=Date.now(),scenario=$('#scenario').value;
 sim=new TicketEngine({choices:list.map((_,i)=>String(i)),quantity:qty,maxTotal:budget,opensAt:now+3000,endsAt:now+120000},simJournal());
 const offers=list.map((c,i)=>({id:String(i),status:scenario==='fallback'&&i===0?'soldout':'available',quantity:qty,total:scenario==='price'?budget+100:budget}));
 $('#run').disabled=true;runState('演练将在3秒后开始，使用虚构库存');
 simTimer=setInterval(()=>{try{const a=sim.decide({schemaOK:true,offers});if(a.kind==='WAIT')return;if(a.kind!=='SUBMIT'){runState(a.reason);stopSim();return;}localStorage.setItem('ticket-ui-sim',JSON.stringify(sim.begin(a)));runState('模拟提交：'+list[Number(a.id)].session+' / '+list[Number(a.id)].tier);const result=scenario==='captcha'||scenario==='timeout'?{kind:'unknown'}:{kind:'success',orderConfirmed:true,id:a.id,quantity:qty,total:a.total};const j=sim.complete(result);localStorage.setItem('ticket-ui-sim',JSON.stringify(j));runState(j.phase==='SUCCESS'?'模拟锁票成功，等待本人付款（没有真实订单）':scenario==='captcha'?'需要本人验证，演练暂停':'结果不明，已暂停，不切换备选');stopSim();}catch(e){runState(e.message);stopSim();}},250);
});
function stopSim(){clearInterval(simTimer);simTimer=null;sim?.stop();$('#run').disabled=false;}
$('#stop').onclick=()=>{stopSim();runState('已停止演练');};
$('#reset-sim').onclick=()=>{stopSim();localStorage.removeItem('ticket-ui-sim');runState('模拟记录已清除，可以重新演练');};
addChoice();addChoice();refresh().catch(e=>tell(e.message));setInterval(countdowns,1000);
if(inExtension)chrome.storage.onChanged.addListener(()=>refresh().catch(e=>tell(e.message)));else tell('当前是界面预览。安装扩展后才能采集官方页面与设置系统提醒。');

$('#url').onchange=()=>{
 const next=C.itemURL($('#url').value)?.id||null;
 if(C.selectionChanged(draftId,next)){
  selected=null;$('#title').value='';$('#opens').value='';$('#choices').replaceChildren();addChoice();
  $('#selected-title').textContent='请核对新演出的名称、开售时间和备选';
 }
 draftId=next;
};
$('#diagnostics').onclick=guard(async()=>{
 const result=await send({type:'DIAGNOSTICS'});
 $('#diagnostic-report').value=JSON.stringify(result.report,null,2);
 $('#diagnostic-report').hidden=false;
 tell('报告只包含版本、数量和运行状态，不含演出名称、链接、预算、账号或观演人信息。');
});
setInterval(renderEvents,30000);

let purchaseRun=null;
async function refreshPurchase(){
 const r=await send({type:'PURCHASE_STATUS'});purchaseRun=r.run;
 $('#purchase-capability').textContent=r.adapters.length?'已安装渠道：'+r.adapters.map(a=>a.name).join('、'):'当前已验证的真实下单渠道：0。执行层已安装，大麦真实选票、下单和查单适配尚未接通。';
 const names={WAITING:'等待检查',PREPARING:'准备结算',SUBMITTING:'提交中',PAUSED:'已暂停',UNKNOWN:'结果不明，须查单',SUCCESS:'已确认待付款',PAID:'已付款',CLOSED:'订单已关闭',STOPPED:'已停止'};
 $('#purchase-state').textContent=purchaseRun?(names[purchaseRun.state]+'：'+purchaseRun.reason):'当前没有真实购买任务';
 $('#purchase-resume').disabled=!purchaseRun||purchaseRun.state!=='PAUSED';
 $('#purchase-stop').disabled=!purchaseRun||['SUCCESS','PAID','CLOSED','STOPPED'].includes(purchaseRun.state);
 $('#purchase-reconcile').disabled=!purchaseRun||!['SUBMITTING','UNKNOWN','SUCCESS'].includes(purchaseRun.state);
}
$('#purchase-check').onclick=guard(refreshPurchase);
$('#purchase-stop').onclick=guard(async()=>{await send({type:'PURCHASE_STOP',runId:purchaseRun.runId});await refreshPurchase();});
$('#purchase-reconcile').onclick=guard(async()=>{await send({type:'PURCHASE_RECONCILE',runId:purchaseRun.runId});await refreshPurchase();});
if(inExtension){
 refreshPurchase().catch(e=>{$('#purchase-capability').textContent=e.message;});
 chrome.storage.onChanged.addListener(changes=>{if(changes.purchaseLedger)refreshPurchase().catch(e=>tell(e.message));});
}

$('#purchase-resume').onclick=guard(async()=>{await send({type:'PURCHASE_RESUME',runId:purchaseRun.runId});await send({type:'PURCHASE_TICK',runId:purchaseRun.runId});await refreshPurchase();});
