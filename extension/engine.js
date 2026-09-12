/* Shared, dependency-free decision engine. No network or payment operations. */
(function (root) {
  'use strict';
  class Engine {
    constructor(config, journal = {phase:'IDLE'}) {
      if (!Array.isArray(config.choices) || !config.choices.length) throw Error('请至少填写一个备选');
      if (!Number.isInteger(config.quantity) || config.quantity < 1) throw Error('张数必须为正整数');
      if (!Number.isSafeInteger(config.maxTotal) || config.maxTotal <= 0) throw Error('最高总价必须为正整数分');
      if (new Set(config.choices).size !== config.choices.length) throw Error('备选不能重复');
      if (!Number.isFinite(config.opensAt) || !Number.isFinite(config.endsAt) || config.endsAt <= config.opensAt) throw Error('时间范围无效');
      this.config=config; this.journal={...journal}; this.stopped=false;
    }
    decide(s, now=Date.now()) {
      if(this.stopped) return {kind:'STOP', reason:'已停止'};
      if(['SUBMITTING','UNKNOWN','SUCCESS','PAID'].includes(this.journal.phase)) return {kind:'STOP',reason:'存在提交记录，请核对订单'};
      if(now>this.config.endsAt) return {kind:'STOP',reason:'已到结束时间'};
      if(s.blocker) return {kind:'PAUSE',reason:s.blocker};
      if(s.existingOrder) return {kind:'PAUSE',reason:'存在未付款订单'};
      if(!s.schemaOK) return {kind:'PAUSE',reason:'页面结构不匹配'};
      if(now<this.config.opensAt) return {kind:'WAIT',reason:'等待开售'};
      for(const id of this.config.choices) {
        const offer=s.offers.find(o=>o.id===id);
        if(!offer || offer.status==='unknown') return {kind:'PAUSE',reason:'票档状态不明，不能当作售罄'};
        if(offer.status==='soldout') continue;
        if(offer.status==='notopen') return {kind:'WAIT',reason:'首选尚未开售'};
        if(offer.status!=='available') return {kind:'PAUSE',reason:'无法识别票档状态'};
        if(!Number.isSafeInteger(offer.total) || offer.total<=0 || offer.quantity!==this.config.quantity || offer.total>this.config.maxTotal)
          return {kind:'PAUSE',reason:'价格或张数不符合配置'};
        return {kind:'SUBMIT',id,quantity:offer.quantity,total:offer.total};
      }
      return {kind:'WAIT',reason:'所有配置票档均无票'};
    }
    begin(action) {
      if(this.stopped || action.kind!=='SUBMIT' || ['SUBMITTING','UNKNOWN','SUCCESS','PAID'].includes(this.journal.phase)) throw Error('不能重复提交');
      this.journal={phase:'SUBMITTING',id:action.id,quantity:action.quantity,total:action.total};
      return {...this.journal};
    }
    complete(result) {
      if(this.journal.phase!=='SUBMITTING') throw Error('没有进行中的提交');
      if(result.kind==='success' && result.id===this.journal.id && result.quantity===this.journal.quantity && result.total===this.journal.total && result.orderConfirmed===true)
        this.journal={...this.journal,phase:'SUCCESS'};
      else if(result.kind==='soldout' && result.definitiveNoOrder===true)
        this.journal={phase:'IDLE'};
      else this.journal={...this.journal,phase:'UNKNOWN'};
      return {...this.journal};
    }
    stop(){this.stopped=true;}
  }
  root.TicketEngine=Engine;
  if(typeof module!=='undefined') module.exports=Engine;
})(globalThis);
