/* Pure parsing helpers. Only explicit sale timestamps count as sale times. */
(function(root){
'use strict';
function itemURL(raw){try{const u=new URL(raw);if(u.protocol!=='https:'||!['detail.damai.cn','m.damai.cn'].includes(u.hostname))return null;if(!['/item.htm','/damai/detail/item.html'].includes(u.pathname))return null;const id=u.searchParams.get('id');if(!/^\d{6,20}$/.test(id||''))return null;if(u.username||u.password||u.port||u.searchParams.getAll('id').length!==1)return null;return {id,url:`https://${u.hostname}${u.pathname}?id=${id}`};}catch{return null;}}
function parseChinaTime(text){
 const m=String(text).match(/^(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?[ T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
 if(!m)return null;const [y,mo,d,h,mi,se]=m.slice(1).map(v=>Number(v||0));
 const t=Date.UTC(y,mo-1,d,h-8,mi,se),date=new Date(t+8*3600000);
 if(date.getUTCFullYear()!==y||date.getUTCMonth()!==mo-1||date.getUTCDate()!==d||h>23||mi>59||se>59)return null;return t;
}
function saleTime(text){
 // Multiple sale rounds must be selected explicitly, never guess the first.
 const date='(20\\d{2}[-/.年]\\d{1,2}[-/.月]\\d{1,2}日?[ T\\s]+\\d{1,2}:\\d{2}(?::\\d{2})?)(?![:\\d])';
 const patterns=[new RegExp('(?:开售时间|开票时间|开售|开票)[：:\\s]*'+date,'g'),new RegExp(date+'[\\s]*(?:开售|开票)','g')];
 const values=patterns.flatMap(p=>[...String(text).matchAll(p)].map(m=>parseChinaTime(m[1])));
 if(!values.length||values.some(v=>v===null))return null;
 const unique=[...new Set(values)];return unique.length===1?unique[0]:null;
}
function planKey(p){return JSON.stringify([p.id,p.opensAt,p.quantity,p.maxTotal,p.choices]);}
function selectionChanged(previous,next){return previous!==null && previous!==next;}
function cleanTitle(s){return String(s||'未命名演出').replace(/\s+/g,' ').trim().slice(0,160);}
function normalize(raw,now=Date.now()){
 if(!raw||typeof raw!=='object')return null;
 const u=itemURL(raw.url);if(!u)return null;
 const saleText=String(raw.saleText||'');
 const title=cleanTitle(raw.title),opensAt=saleText.length<=120?saleTime(saleText):null;
 return {...u,title,opensAt,source:'official-page',capturedAt:now,upcomingLabel:Boolean(raw.upcomingLabel),city:(title.match(/[【\[]([^】\]]{1,12})[】\]]/)||[])[1]||''};
}
function merge(old,updates,now=Date.now()){
 const map=new Map(old.map(x=>[x.id,x]));
 for(const r of updates){const item=normalize(r,now);if(item)map.set(item.id,item);}
 return [...map.values()].sort((a,b)=>b.capturedAt-a.capturedAt).slice(0,200);
}
function status(item,now=Date.now()){
 if(now-item.capturedAt>24*3600000)return 'stale';
 if(item.opensAt&&item.opensAt>now)return 'upcoming';
 if(item.opensAt)return 'elapsed';
 return item.upcomingLabel?'time-unknown':'unknown';
}
function money(text){if(!/^\d+(?:\.\d{1,2})?$/.test(String(text)))throw Error('金额最多保留两位小数');const [a,b='']=String(text).split('.');const cents=Number(a)*100+Number((b+'00').slice(0,2));if(!Number.isSafeInteger(cents)||cents<=0)throw Error('金额必须大于0');return cents;}
function plan(raw,now=Date.now()){
 const item=itemURL(raw.url);if(!item)throw Error('请使用大麦官方演出详情链接');
 const opensAt=parseChinaTime(raw.opensAt);if(opensAt===null||opensAt<=now)throw Error('请填写未来的北京时间开售时间');
 const quantity=Number(raw.quantity);if(!Number.isInteger(quantity)||quantity<1||quantity>20)throw Error('张数须为1至20的整数，实际限购以项目为准');
 const maxTotal=money(raw.maxTotal);if(!Array.isArray(raw.choices)||!raw.choices.length||raw.choices.length>10)throw Error('请添加1至10个场次/票档组合');
 const seen=new Set();const choices=raw.choices.map(c=>{const session=String(c.session||'').trim().slice(0,100),tier=String(c.tier||'').trim().slice(0,60);if(!session||!tier)throw Error('每个备选都要填写场次和票档');const key=session+'\0'+tier;if(seen.has(key))throw Error('请删除重复的场次和票档');seen.add(key);return {session,tier};});
 return {...item,title:cleanTitle(raw.title),opensAt,quantity,maxTotal,choices,mode:'reminder',createdAt:now};
}
const api={planKey,selectionChanged,itemURL,parseChinaTime,saleTime,normalize,merge,status,money,plan};root.TicketCatalog=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
