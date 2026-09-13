/* Durable purchase coordinator. No Damai page adapter is bundled yet.
 * Instantiate once in the extension worker; page scripts never own this record.
 */
(function(root) {
  'use strict';
  const Engine = root.TicketEngine || (typeof require === 'function' && require('./engine.js'));
  const STATES = ['WAITING','PREPARING','SUBMITTING','PAUSED','UNKNOWN','SUCCESS','PAID','CLOSED','STOPPED'];
  const TERMINAL = ['PAID','CLOSED','STOPPED'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 160;
  class Coordinator {
    constructor({read, write, now = Date.now, id = () => crypto.randomUUID(), adapters = [], timeoutMs = 15000}) {
      this.read = read; this.write = write; this.now = now; this.id = id;
      this.adapters = new Map(adapters.map(a => [a.id, a]));
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('超时配置无效');
      this.timeoutMs = timeoutMs;
      this.queue = Promise.resolve(); this.busy = false; this.stops = new Set();
    }
    serial(fn) {
      const result = this.queue.then(fn);
      this.queue = result.catch(() => {});
      return result;
    }
    async load() {
      const db = await this.read();
      if (db === undefined) return {schema:1, run:null};
      if (!db || db.schema !== 1 || !Object.hasOwn(db,'run')) throw Error('购买记录损坏，不能重新下单');
      const r = db.run;
      if (r !== null) {
        if (!r || !validId(r.runId) || !STATES.includes(r.state) || !validId(r.adapterId) ||
            !Number.isInteger(r.tabId) || r.tabId < 0 || !r.plan || !validId(r.plan.itemId) ||
            !Array.isArray(r.rejected) || r.rejected.some(x => !r.plan.choices.includes(x))) throw Error('购买记录损坏，不能重新下单');
        new Engine(r.plan);
        if (['SUBMITTING','UNKNOWN','SUCCESS','PAID','CLOSED'].includes(r.state) && !r.attempt) throw Error('缺少提交记录，请核对订单');
        if (r.attempt && (!validId(r.attempt.attemptId) || !r.plan.choices.includes(r.attempt.choiceId) ||
            r.attempt.itemId !== r.plan.itemId || r.attempt.quantity !== r.plan.quantity ||
            !Number.isSafeInteger(r.attempt.total) || r.attempt.total <= 0 || r.attempt.total > r.plan.maxTotal ||
            !Number.isFinite(r.attempt.at))) throw Error('提交记录损坏，请核对订单');
        if (['SUCCESS','PAID','CLOSED'].includes(r.state) && (!r.order || !validId(r.order.orderId) || r.order.status !== {SUCCESS:'pending-payment',PAID:'paid',CLOSED:'closed'}[r.state])) throw Error('订单确认记录损坏');
        if (['WAITING','PREPARING','PAUSED','STOPPED'].includes(r.state) && r.attempt) throw Error('尚有提交记录，不能重新下单');
      }
      return copy(db);
    }
    async save(db) { await this.write(copy(db)); }
    status() { return this.serial(async () => copy((await this.load()).run)); }
    recover() {
      return this.serial(async () => {
        const db = await this.load(), r = db.run;
        if (!r) return null;
        if (r.state === 'SUBMITTING') {r.state = 'UNKNOWN'; r.reason = '提交中断，须先核对官方订单';}
        else if (['WAITING','PREPARING'].includes(r.state)) {r.state = 'PAUSED'; r.reason = '后台已重启，须重新核对页面';}
        else return copy(r);
        await this.save(db); return copy(r);
      });
    }
    start(plan, tabId, adapterId) {
      // Copy synchronously, before queued operations give the caller time to mutate it.
      const frozenPlan = copy(Object.fromEntries(['itemId','choices','quantity','maxTotal','opensAt','endsAt'].map(k=>[k,plan?.[k]])));
      return this.serial(async () => {
        const a = this.adapters.get(adapterId);
        if (!a) throw Error('此渠道尚无真实下单适配器，不能启动自动购票');
        new Engine(frozenPlan);
        if (!validId(frozenPlan.itemId) || !Number.isInteger(tabId) || tabId < 0 ||
            this.now() > frozenPlan.endsAt || a.supports(frozenPlan) !== true) throw Error('项目或购买配置不受支持');
        const db = await this.load();
        if (this.busy || (db.run && !TERMINAL.includes(db.run.state))) throw Error('已有购买任务或待核对订单，不能重复启动');
        db.run = {runId:this.id(), adapterId, tabId, plan:frozenPlan, state:'WAITING',
          reason:'等待读取官方页面', rejected:[], attempt:null, order:null};
        await this.save(db); return copy(db.run);
      });
    }
    stop(runId) {
      // Immediate flag stops the next action even if a page operation is awaiting a reply.
      this.stops.add(runId);
      return this.serial(async () => {
        const db = await this.load(), r = db.run;
        if (!r || r.runId !== runId) throw Error('购买任务已变化');
        if (!['SUCCESS','PAID','CLOSED'].includes(r.state)) {
          r.state = r.attempt ? 'UNKNOWN' : 'STOPPED';
          r.reason = r.attempt ? '已停止新操作，但在途提交仍须查单' : '已停止';
          await this.save(db);
        }
        return copy(r);
      });
    }
    resume(runId) {
      return this.serial(async () => {
        const db = await this.load(), r = db.run;
        if (this.busy || !r || r.runId !== runId || r.state !== 'PAUSED' || r.attempt) throw Error('当前任务不能恢复购买');
        if (this.now() > r.plan.endsAt) throw Error('购买时间已结束');
        r.state = 'WAITING'; r.reason = '等待重新检查页面';
        await this.save(db); this.stops.delete(runId); return copy(r);
      });
    }
    fresh(observation, r) {
      return observation && observation.source === 'official-page' && observation.itemId === r.plan.itemId &&
        observation.tabId === r.tabId && Number.isFinite(observation.observedAt) &&
        observation.observedAt <= this.now() && this.now() - observation.observedAt <= 1500;
    }
    async change(runId, fn) {
      return this.serial(async () => {
        const db = await this.load();
        if (!db.run || db.run.runId !== runId) throw Error('过期的购买任务');
        await fn(db.run); await this.save(db); return copy(db.run);
      });
    }
    async bounded(fn) {
      let timer;
      try {
        return await Promise.race([Promise.resolve().then(fn), new Promise((_,reject) => {
          timer=setTimeout(() => reject(Error('页面响应超时')),this.timeoutMs);
        })]);
      } finally {clearTimeout(timer);}
    }
    async tick(runId) {
      if (this.busy) throw Error('购买检查正在执行');
      this.busy = true;
      try {
        let r = await this.status();
        if (!r || r.runId !== runId) throw Error('过期的购买任务');
        if (r.state !== 'WAITING' || this.stops.has(runId)) return r;
        const a = this.adapters.get(r.adapterId);
        if (!a) throw Error('真实下单适配器不可用');
        const context = {runId, tabId:r.tabId};
        const snapshot = await this.bounded(() => a.inspect(copy(r.plan), context));
        if (this.stops.has(runId)) return await this.status();
        if (!this.fresh(snapshot,r) || snapshot.loginConfirmed !== true || snapshot.existingOrder !== false) {
          return await this.change(runId, x => {x.state='PAUSED'; x.reason='页面、登录或已有订单状态未确认';});
        }
        const e = new Engine(r.plan);
        const offers = snapshot.offers?.map(o => r.rejected.includes(o?.id) ? {...o,status:'soldout'} : o);
        const action = e.decide({...snapshot,offers},this.now());
        if (action.kind !== 'SUBMIT') return await this.change(runId, x => {
          x.state = {WAIT:'WAITING',PAUSE:'PAUSED',STOP:'STOPPED'}[action.kind]; x.reason=action.reason;
        });
        await this.change(runId, x => {x.state='PREPARING'; x.reason='正在选择票档并核对结算';});
        if (this.stops.has(runId)) return await this.status();
        await a.prepare(copy(action),context); // Selection only; MUST NOT submit an order.
        if (this.stops.has(runId)) return await this.status();
        const checkout = await this.bounded(() => a.readCheckout(context));
        if (this.stops.has(runId)) return await this.status();
        if (!this.fresh(checkout,r) || checkout.schemaOK !== true || checkout.blocker ||
            checkout.loginConfirmed !== true || checkout.existingOrder !== false || checkout.viewersConfirmed !== true ||
            !validId(checkout.documentId) || checkout.choiceId !== action.id || checkout.quantity !== action.quantity ||
            checkout.total !== action.total || this.now() > r.plan.endsAt) {
          return await this.change(runId, x => {x.state='PAUSED'; x.reason='结算信息不匹配或需要本人处理';});
        }
        r = await this.change(runId, x => {
          if (this.stops.has(runId) || x.state !== 'PREPARING') throw Error('已停止提交');
          x.attempt = {attemptId:this.id(),itemId:x.plan.itemId,choiceId:action.id,
            quantity:action.quantity,total:action.total,at:this.now(),documentId:checkout.documentId};
          x.state='SUBMITTING'; x.reason='提交意图已保存，等待官方结果';
        });
        // Stop during the storage write must also prevent a click. Keep the intent for reconciliation.
        if (this.stops.has(runId)) return await this.status();
        if (!this.fresh(checkout,r) || this.now() > r.plan.endsAt) return await this.change(runId, x => {x.state='UNKNOWN'; x.reason='提交准备超时，未派发点击；保留意图供核对';});
        try { await this.bounded(() => a.submitOnce(copy(r.attempt),context)); } catch { /* A rejected transport is not proof of no order. */ }
        return await this.reconcile(runId);
      } catch (error) {
        // No raw page/adapter error text goes into persisted logs.
        await this.change(runId, r => {
          if (['WAITING','PREPARING','SUBMITTING'].includes(r.state)) {
            r.state=r.attempt?'UNKNOWN':'PAUSED'; r.reason='页面操作或存储失败，请先核对状态';
          }
        }).catch(() => {});
        throw error;
      } finally { this.busy=false; }
    }
    async reconcile(runId) {
      const r = await this.status();
      if (!r || r.runId !== runId || !r.attempt || !['SUBMITTING','UNKNOWN','SUCCESS'].includes(r.state)) throw Error('没有需要核对的提交');
      const a = this.adapters.get(r.adapterId);
      let observation;
      try { observation = await this.bounded(() => a?.reconcile(copy(r.attempt),{runId,tabId:r.tabId})); } catch {}
      return this.change(runId, x => {
        // A late query must not overwrite a newer outcome / attempt.
        if (x.attempt?.attemptId !== r.attempt.attemptId || !['SUBMITTING','UNKNOWN','SUCCESS'].includes(x.state)) return;
        const o=observation, t=x.attempt;
        const evidence=this.fresh(o,x) && o.authoritative===true && o.attemptId===t.attemptId;
        const matches=evidence && o.kind==='order' && validId(o.orderId) && o.choiceId===t.choiceId &&
          o.quantity===t.quantity && o.total===t.total && Number.isFinite(o.createdAt) &&
          o.createdAt>=t.at && o.createdAt<=o.observedAt && ['pending-payment','paid','closed'].includes(o.status);
        if (matches) {
          if (x.order && x.order.orderId !== o.orderId) {x.reason='查单返回不同订单，须人工核对'; return;}
          x.state={'pending-payment':'SUCCESS',paid:'PAID',closed:'CLOSED'}[o.status];
          x.order={orderId:o.orderId,status:o.status}; x.reason=x.state==='SUCCESS'?'官方待付款订单已匹配，请本人付款':'官方订单状态已核对';
        } else if (x.state==='SUCCESS') {
          x.reason='本次未取得新的订单证据，保留此前已确认订单';
        } else if (evidence && o.kind==='no-order' && o.final===true && o.reason==='soldout') {
          x.rejected=[...new Set([...x.rejected,t.choiceId])]; x.attempt=null;
          x.state=this.stops.has(runId)?'STOPPED':'WAITING'; x.reason='已确认未形成订单且售罄，可检查后续备选';
        } else {x.state='UNKNOWN'; x.reason='结果不明，禁止重复提交或切换备选';}
      });
    }
  }
  root.TicketPurchase={Coordinator};
  if(typeof module!=='undefined')module.exports={Coordinator};
})(globalThis);
