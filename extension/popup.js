const status=document.querySelector('#status');
async function run(stop=false){
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    const url=new URL(tab.url);
    if(url.protocol!=='https:' || !(url.hostname==='damai.cn'||url.hostname.endsWith('.damai.cn'))) throw Error('请先打开官方 https 大麦网页');
    const keyword=document.querySelector('#keyword').value.trim();
    if(!stop && !keyword) throw Error('请输入提醒文字');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['monitor.js']});
    const response=await chrome.tabs.sendMessage(tab.id,{type:stop?'STOP':'START',keyword});
    status.textContent=response.message;
  }catch(e){status.textContent='未启动：'+e.message;}
}
document.querySelector('#start').onclick=()=>run();
document.querySelector('#stop').onclick=()=>run(true);

document.querySelector('#dashboard').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('ui/dashboard.html')});
