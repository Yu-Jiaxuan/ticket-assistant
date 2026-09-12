(()=>{
  if(globalThis.__ticketMonitorLoaded)return;
  globalThis.__ticketMonitorLoaded=true;
  let timer,observer,host,word,last=false;
  function stop(){clearTimeout(timer);observer?.disconnect();host?.remove();host=null;}
  function check(){
    if(!host)return;
    // Overlay text lives in shadow DOM and is excluded from body.innerText.
    const text=document.body.innerText;
    const hit=text.includes(word);
    const line=host.shadowRoot.querySelector('p');
    line.textContent=hit?'发现目标文字，请核实官方票档与订单状态。':'观察中：'+word+'（不自动刷新）';
    if(hit&&!last){
      try{const a=new AudioContext();const o=a.createOscillator();const g=a.createGain();o.connect(g);g.connect(a.destination);g.gain.value=.08;o.start();o.stop(a.currentTime+.3);o.onended=()=>a.close();}catch{}
    }
    last=hit;
  }
  chrome.runtime.onMessage.addListener((m,sender,respond)=>{
    if(m.type==='STOP'){stop();respond({message:'已停止'});return;}
    if(m.type!=='START')return;
    stop();word=String(m.keyword).slice(0,60);last=false;
    host=document.createElement('div');host.style.cssText='position:fixed;right:20px;bottom:20px;z-index:2147483647';
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML='<style>section{font:14px system-ui;background:#14213d;color:white;padding:18px;border-radius:12px;max-width:320px}button{padding:7px}</style><section><strong>票务助手 · 页面观察</strong><p></p><button>停止</button></section>';
    shadow.querySelector('button').onclick=stop;document.body.append(host);
    observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(check,250);});
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
    check();respond({message:'已启动页面观察；真实自动下单未启用。'});
  });
})();
