/* Runs only on public search/detail pages. No cookie, input or order access. */
(()=>{
 if(globalThis.__ticketCollect){globalThis.__ticketCollect();return;}
 let timer,last='';
 const visible=el=>Boolean(el?.getClientRects().length);
 function publicCard(anchor){
   let node=anchor;
   for(let i=0;i<4&&node.parentElement;i++,node=node.parentElement){
     if(node.tagName==='BODY')break;
     const links=[...node.querySelectorAll('a[href]')].filter(a=>TicketCatalog.itemURL(a.href));
     if(new Set(links.map(a=>TicketCatalog.itemURL(a.href).id)).size>1)break;
     const text=node.innerText||'';
     if(text.length<900&&/(开售|开票|即将)/.test(text))return text;
   }
   return anchor.innerText||'';
 }
 function collect(){
  try{
   const records=[];
   for(const a of document.querySelectorAll('a[href]')){
    if(!visible(a)||!TicketCatalog.itemURL(a.href))continue;
    const title=(a.innerText||a.getAttribute('title')||a.querySelector('img')?.alt||'').trim();if(!title)continue;
    const nearby=publicCard(a),line=nearby.split('\n').find(t=>/(开售|开票)/.test(t))||'';
    records.push({url:a.href,title,saleText:line.slice(0,120),upcomingLabel:/即将开售|尚未开售|未开售|即将开票/.test(nearby)});
    if(records.length>=100)break;
   }
   // Detail page: title + short sale-status nodes, never body text.
   if(TicketCatalog.itemURL(location.href)){
     const heading=document.querySelector('h1');let saleText='',upcomingLabel=false;
     for(const el of document.querySelectorAll('span,p,time')){
       if(!visible(el)||el.children.length)continue;const t=(el.innerText||'').trim();
       if(t.length<=120&&/开售|开票/.test(t)){if(TicketCatalog.saleTime(t))saleText=t;upcomingLabel ||= /即将开售|未开售|即将开票/.test(t);}
     }
     if(heading?.innerText)records.unshift({url:location.href,title:heading.innerText,saleText,upcomingLabel});
   }
   const signature=JSON.stringify(records);if(signature===last)return;last=signature;
   chrome.runtime.sendMessage({type:'CATALOG_CAPTURE',records}).catch(()=>{});
  }catch{/* DOM changes must not affect the host page. */}
 }
 globalThis.__ticketCollect=()=>{last='';collect();};
 const observer=new MutationObserver(()=>{if(!timer)timer=setTimeout(()=>{timer=null;collect();},1000);});
 observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});collect();
})();
