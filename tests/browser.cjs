// Optional end-to-end demo checks. Run local server on 127.0.0.1:8765 first.
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});let checks=0;
 try{
  const page=await browser.newPage();
  for(const [scenario,expected] of [['fallback','模拟订单已确认'],['race','模拟订单已确认'],['captcha','需要人工验证'],['timeout','提交结果不明'],['login','登录失效'],['queue','排队中'],['schema','页面结构不匹配'],['existing','存在未付款订单'],['price','价格或张数'],['mismatch','提交结果不明']]){
    await page.goto('http://127.0.0.1:8765/demo/');await page.evaluate(()=>localStorage.clear());await page.reload();
    await page.locator('#delay').fill('0');await page.locator('#scenario').selectOption(scenario);await page.locator('#start').click();
    await page.waitForFunction(expected=>document.querySelector('#state').textContent.includes(expected),expected,{timeout:5000});
    if(scenario==='fallback'||scenario==='race')assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ticket-demo-v1')).id),'sat480');
    if(scenario==='timeout'){
      await page.locator('#reconcile').click();await page.waitForFunction(()=>document.querySelector('#state').textContent.includes('订单已成立'));
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ticket-demo-v1')).phase),'SUCCESS');
    }
    checks++;console.log('PASS',scenario);
  }
  console.log('Browser scenarios passed:',checks);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
