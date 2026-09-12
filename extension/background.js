importScripts('catalog.js');
const SEARCH='https://search.damai.cn/search.htm';
let writes=Promise.resolve();
function serial(fn){const p=writes.then(fn);writes=p.catch(()=>{});return p;}
function sourceAllowed(raw){try{const u=new URL(raw);return u.protocol==='https:'&&((u.hostname==='search.damai.cn'&&u.pathname==='/search.htm')||TicketCatalog.itemURL(raw));}catch{return false;}}
async function record(message){const {activity=[]}=await chrome.storage.local.get('activity');activity.unshift({at:Date.now(),message});await chrome.storage.local.set({activity:activity.slice(0,80)});}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
 const fromUI=sender.url===chrome.runtime.getURL('ui/dashboard.html');
 if(m.type==='CATALOG_CAPTURE'){
  if(!sourceAllowed(sender.tab?.url)||!Array.isArray(m.records)){respond({ok:false});return;}
  serial(async()=>{const {catalog=[]}=await chrome.storage.local.get('catalog');const updated=TicketCatalog.merge(catalog,m.records.slice(0,100));await chrome.storage.local.set({catalog:updated,lastCapture:{at:Date.now(),count:m.records.length}});return {ok:true};}).then(respond,()=>respond({ok:false}));return true;
 }
 if(!fromUI)return;
 serial(async()=>{
  if(m.type==='SCAN'){
   const tabs=await chrome.tabs.query({url:['https://search.damai.cn/*','https://detail.damai.cn/*','https://m.damai.cn/*']});let count=0;
   for(const tab of tabs.filter(t=>sourceAllowed(t.url))){try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['catalog.js','collector.js']});count++;}catch{}}
   await record(count?`已观察 ${count} 个官方页面；页面变化会自动更新列表`:'没有可采集的官方页面，请先打开大麦搜索页');return {ok:true,count};
  }
  if(m.type==='SAVE_PLAN'){
   const p=TicketCatalog.plan(m.plan);const task={...p,taskId:crypto.randomUUID(),state:'scheduled'};
   const {tasks=[]}=await chrome.storage.local.get('tasks');if(tasks.filter(t=>t.state==='scheduled').length>=20)throw Error('最多保留20个待提醒计划');
   await chrome.alarms.create(task.taskId,{when:task.opensAt});
   try{await chrome.storage.local.set({tasks:[task,...tasks].slice(0,100)});}catch(e){await chrome.alarms.clear(task.taskId);throw e;}
   await record('已保存开售提醒计划（不自动下单）');return {ok:true};
  }
  if(m.type==='CANCEL'){
   const {tasks=[]}=await chrome.storage.local.get('tasks');const t=tasks.find(t=>t.taskId===m.taskId);if(t){t.state='cancelled';await chrome.alarms.clear(t.taskId);await chrome.storage.local.set({tasks});}return {ok:true};
  }
  if(m.type==='CLEAR_CATALOG'){await chrome.storage.local.set({catalog:[]});return {ok:true};}
  throw Error('未知操作');
 }).then(respond,e=>respond({ok:false,error:e.message}));return true;
});
async function due(name){
 const {tasks=[]}=await chrome.storage.local.get('tasks');const task=tasks.find(t=>t.taskId===name&&t.state==='scheduled');if(!task)return;
 task.state='notified';await chrome.storage.local.set({tasks});
 try{await chrome.notifications.create(task.taskId,{type:'basic',iconUrl:'icon.png',title:'开售时间已到',message:task.title+'：请到官方页面确认是否开售。当前版本不自动下单。'});}catch{await record('系统通知未显示，请查看计划列表');}
 await chrome.action.setBadgeText({text:'到点'});await record('计划时间已到，请在官方页面确认开售状态');
}
chrome.alarms.onAlarm.addListener(a=>serial(()=>due(a.name)));
chrome.notifications.onClicked.addListener(id=>serial(async()=>{const {tasks=[]}=await chrome.storage.local.get('tasks');const task=tasks.find(t=>t.taskId===id);if(task)await chrome.tabs.create({url:task.url});}));
chrome.runtime.onStartup.addListener(()=>serial(async()=>{
 const {tasks=[]}=await chrome.storage.local.get('tasks');for(const task of tasks.filter(t=>t.state==='scheduled')){
  if(task.opensAt<=Date.now())await due(task.taskId);else await chrome.alarms.create(task.taskId,{when:task.opensAt});
 }
}));
