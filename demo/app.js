'use strict';
const $=s=>document.querySelector(s), key='ticket-demo-v1';
let engine,running=false,generation=0,verified=false,offers=[],scenario,releaseLock,pending=false;
const labels={sat680:'周六晚场 · 680 元',sat480:'周六晚场 · 480 元',sun680:'周日晚场 · 680 元'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function saved(){return JSON.parse(localStorage.getItem(key)||'{"phase":"IDLE"}');}
function persist(j){localStorage.setItem(key,JSON.stringify(j));}
function log(message){$('#log').textContent+=new Date().toLocaleTimeString()+'  '+message+'\n';}
function status(message){$('#state').textContent=message;log(message);}
function render(){ $('#offers').replaceChildren(...offers.map(o=>{const d=document.createElement('div');d.className='offer';d.textContent=labels[o.id]+' / '+({'soldout':'售罄','available':'可购买'}[o.status]||o.status);return d;})); }
function halt(){running=false;generation++;engine?.stop();releaseLock?.();releaseLock=null;$('#start').disabled=false;}
async function submit(action){
  await sleep(200);
  if(scenario==='race'&&action.id==='sat680'){offers[0].status='soldout';render();return {kind:'soldout',definitiveNoOrder:true};}
  if(scenario==='captcha'&&!verified){$('#human').textContent='这是模拟验证，请本人点击下方按钮。真实验证码不由程序代答。';$('#verify').hidden=false;return {kind:'verification'};}
  if(scenario==='timeout')return {kind:'unknown'};
  return {kind:'success',orderConfirmed:true,id:scenario==='mismatch'?'unexpected':action.id,quantity:action.quantity,total:action.total};
}
async function start(){
  if(running)return;
  if(pending){status("上一笔提交尚未返回，请等待并核对订单");return;}
  if(!navigator.locks){status('浏览器不支持单实例锁，请使用新版 Chrome / Edge');return;}
  await navigator.locks.request('ticket-demo-single-run',{ifAvailable:true},async lock=>{
    if(!lock){status('另一标签页正在运行，请先停止它');return;}
    let done;const held=new Promise(r=>done=r);releaseLock=done;
    try{
      const delay=Number($('#delay').value),budget=Number($('#budget').value),quantity=Number($('#quantity').value);
      if(!Number.isFinite(delay)||delay<0||delay>3600||!Number.isFinite(budget)||!Number.isInteger(quantity)||quantity>4)throw Error('请检查金额、时间和张数（演示最多4张）');
      const now=Date.now();
      engine=new TicketEngine({choices:$('#choices').value.split(',').map(v=>v.trim()),quantity,maxTotal:Math.round(budget*100),opensAt:now+delay*1000,endsAt:now+(delay+120)*1000},saved());
      scenario=$('#scenario').value;verified=false;running=true;const token=++generation;$('#start').disabled=true;
      for(const id of ['verify','reconcile','pay'])$('#'+id).hidden=true;
      offers=Object.keys(labels).map((id,i)=>({id,status:scenario==='fallback'&&i===0?'soldout':'available',quantity,total:(i===1?48000:68000)*quantity+(scenario==='price'?100000:0)}));render();
      while(running&&token===generation){
        const blocker=scenario==='login'?'登录失效':scenario==='queue'?'排队中，请人工查看官方进度':null;
        const action=engine.decide({schemaOK:scenario!=='schema',blocker,existingOrder:scenario==='existing',offers});
        if(action.kind==='WAIT'){if($('#state').textContent!==action.reason)status(action.reason);await sleep(250);continue;}
        if(action.kind!=='SUBMIT'){status(action.reason);halt();break;}
        // Durable intent is written BEFORE attempting a side effect.
        persist(engine.begin(action));status('尝试提交：'+labels[action.id]);
        pending=true;
        let result;try{result=await submit(action);}finally{pending=false;}
        // Even a late result after STOP is journaled; never perform another purchase.
        const journal=engine.complete(result);persist(journal);
        if(journal.phase==='SUCCESS'){
          status('模拟订单已确认，等待付款');$('#pay').hidden=false;halt();break;
        }
        if(journal.phase==='UNKNOWN'){
          status(result.kind==='verification'?'需要人工验证；自动购买暂停':'提交结果不明或订单不匹配，禁止切备选');
          $('#reconcile').hidden=false;halt();break;
        }
        if(!running||token!==generation)break;
        status('首选明确售罄且未创建订单，重新按优先级选择');
      }
    }catch(e){status(e.message);halt();}
    await held;
  });
}
$('#start').onclick=start;
$('#stop').onclick=()=>{halt();status('已停止新操作；已发出的提交无法撤回，请核对订单');};
$('#verify').onclick=()=>{
  verified=true;$('#verify').hidden=true;$('#human').textContent='模拟服务端确认验证完成，尚未创建订单。请先查询结果。';
};
$('#reconcile').onclick=()=>{
  const j=saved();
  if(scenario==='timeout'&&j.phase==='UNKNOWN'){
    persist({...j,phase:'SUCCESS'});status('模拟查询确认订单已成立，未重复下单');$('#pay').hidden=false;
  }else if(scenario==='captcha'&&verified){persist({phase:'IDLE'});status('模拟查询确认没有订单，可以选择其他场景后重新启动');}
  else status('未获得明确结果，继续暂停；核对完成前不要清除记录');
};
$('#pay').onclick=()=>{persist({phase:'PAID'});$('#pay').hidden=true;status('模拟付款完成（没有发生真实支付）');};
$('#reset').onclick=()=>{if(pending){status('提交仍在进行中，请等待结果');return;}if(!confirm('仅用于演示：确认已核对模拟订单，清除提交记录？'))return;halt();persist({phase:'IDLE'});for(const id of ['verify','reconcile','pay'])$('#'+id).hidden=true;status('演示记录已清除');};
try{if(['UNKNOWN','SUBMITTING','SUCCESS','PAID'].includes(saved().phase))status('检测到历史提交，请核对订单；不会自动重试');}catch{status('本地记录损坏，请核对订单后清除演示记录');}
