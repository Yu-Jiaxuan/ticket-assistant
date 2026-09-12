const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),C=require('../extension/catalog.js');
const url='https://detail.damai.cn/item.htm?id=123456789';
function capture(lines){
 let message;
 const nodes=lines.map(innerText=>({innerText,children:[],getClientRects:()=>[{}]}));
 const document={documentElement:{},querySelector:()=>({innerText:'测试演出'}),querySelectorAll:selector=>selector==='span,p,time'?nodes:[]};
 vm.runInNewContext(fs.readFileSync('extension/collector.js','utf8'),{TicketCatalog:C,document,location:{href:url},MutationObserver:class{observe(){}},setTimeout,chrome:{runtime:{sendMessage:msg=>{message=msg;return Promise.resolve();}}}});
 return C.merge([],message.records)[0];
}
test('detail collection keeps a single explicit opening time',()=>{assert.equal(capture(['开售：2099-09-20 12:00']).opensAt,C.parseChinaTime('2099-09-20 12:00'));});
test('detail collection does not silently pick the last of multiple sale rounds',()=>{assert.equal(capture(['开售：2099-09-20 12:00','开售：2099-09-21 12:00']).opensAt,null);});
test('duplicate status nodes preserve a known time and unrelated dates are ignored',()=>{assert.equal(capture(['演出时间：2099-10-20 19:30','开售：2099-09-20 12:00','开售：2099-09-20 12:00']).opensAt,C.parseChinaTime('2099-09-20 12:00'));});
