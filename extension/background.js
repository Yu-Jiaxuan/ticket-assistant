importScripts('catalog.js', 'engine.js', 'purchase.js', 'adapters.js');
const purchase = new TicketPurchase.Coordinator({
  read: async () => (await chrome.storage.local.get('purchaseLedger')).purchaseLedger,
  write: async value => chrome.storage.local.set({purchaseLedger:value}),
  adapters: TicketPurchaseAdapters
});
let purchaseError = null;
const purchaseReady = chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})
  .then(() => purchase.recover())
  .catch(() => {purchaseError = '购买记录或存储初始化失败，自动购买已禁用';});
let writes = Promise.resolve();
function serial(fn) {
  const pending = writes.then(fn);
  writes = pending.catch(() => {});
  return pending;
}
function sourceAllowed(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ((url.hostname === 'search.damai.cn' && url.pathname === '/search.htm') || TicketCatalog.itemURL(raw));
  } catch { return false; }
}
async function record(message) {
  // A log failure must not report a successfully saved plan as a failed save.
  try {
    const { activity = [] } = await chrome.storage.local.get('activity');
    await chrome.storage.local.set({ activity: [{ at: Date.now(), message }, ...activity].slice(0, 80) });
  } catch {}
}
async function publicTabs() {
  const tabs = await chrome.tabs.query({ url: ['https://search.damai.cn/*', 'https://detail.damai.cn/*', 'https://m.damai.cn/*'] });
  return tabs.filter(tab => sourceAllowed(tab.url));
}
async function diagnostics() {
  const { catalog = [], tasks = [], lastCapture } = await chrome.storage.local.get(['catalog', 'tasks', 'lastCapture']);
  const states = {};
  for (const task of tasks) states[task.state] = (states[task.state] || 0) + 1;
  return {
    version: chrome.runtime.getManifest().version,
    generatedAt: new Date().toISOString(),
    publicPageCount: (await publicTabs()).length,
    catalogCount: catalog.length,
    knownOpeningTimeCount: catalog.filter(item => Number.isFinite(item.opensAt)).length,
    lastCaptureAt: lastCapture?.at || null,
    taskStates: states,
    alarmCount: (await chrome.alarms.getAll()).length,
    notificationPermission: await chrome.notifications.getPermissionLevel(),
    realCheckoutSupported: false
  };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'CATALOG_CAPTURE') {
    // Validate the frame URL too: a third-party iframe is not the official page.
    if (sender.frameId > 0 || !sourceAllowed(sender.url) || !sourceAllowed(sender.tab?.url) || !Array.isArray(message.records)) {
      respond({ ok: false }); return;
    }
    serial(async () => {
      const { catalog = [] } = await chrome.storage.local.get('catalog');
      const updated = TicketCatalog.merge(catalog, message.records.slice(0, 100));
      await chrome.storage.local.set({ catalog: updated, lastCapture: { at: Date.now(), count: message.records.length } });
      return { ok: true };
    }).then(respond, () => respond({ ok: false }));
    return true;
  }
  if (sender.url !== chrome.runtime.getURL('ui/dashboard.html')) return;
  if (message.type.startsWith('PURCHASE_')) {
    (async () => {
      await purchaseReady;
      if (purchaseError) throw Error(purchaseError);
      if (message.type === 'PURCHASE_STATUS') return {ok:true,
        adapters:TicketPurchaseAdapters.map(a => ({id:a.id,name:a.name})), run:await purchase.status()};
      if (message.type === 'PURCHASE_START') return {ok:true,run:await purchase.start(message.plan,message.tabId,message.adapterId)};
      if (message.type === 'PURCHASE_TICK') return {ok:true,run:await purchase.tick(message.runId)};
      if (message.type === 'PURCHASE_STOP') return {ok:true,run:await purchase.stop(message.runId)};
      if (message.type === 'PURCHASE_RESUME') return {ok:true,run:await purchase.resume(message.runId)};
      if (message.type === 'PURCHASE_RECONCILE') return {ok:true,run:await purchase.reconcile(message.runId)};
      throw Error('未知购买操作');
    })().then(respond, () => respond({ok:false,error:purchaseError || '购买操作未完成；请检查渠道支持和购买记录，不能直接重试提交'}));
    return true;
  }
  serial(async () => {
    if (message.type === 'DIAGNOSTICS') return { ok: true, report: await diagnostics() };
    if (message.type === 'SCAN') {
      let count = 0, failed = 0;
      for (const tab of await publicTabs()) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['catalog.js', 'collector.js'] });
          count++;
        } catch { failed++; }
      }
      await record(count ? `已观察 ${count} 个官方页面` : '没有可采集页面，请先打开官方搜索或详情页');
      return { ok: true, count, failed };
    }
    if (message.type === 'SAVE_PLAN') {
      const plan = TicketCatalog.plan(message.plan);
      const { tasks = [] } = await chrome.storage.local.get('tasks');
      const pending = tasks.filter(task => task.state === 'scheduled');
      const duplicate = pending.find(task => TicketCatalog.planKey(task) === TicketCatalog.planKey(plan));
      if (duplicate) return { ok: true, duplicate: true, taskId: duplicate.taskId };
      if (pending.length >= 20) throw Error('最多保留20个待提醒计划');
      const task = { ...plan, taskId: crypto.randomUUID(), state: 'scheduled' };
      // Save intent first. Worker recovery recreates an alarm lost to interruption.
      await chrome.storage.local.set({ tasks: [task, ...tasks].slice(0, 100) });
      try {
        await chrome.alarms.create(task.taskId, { when: task.opensAt });
      } catch {
        task.state = 'schedule-failed';
        await chrome.storage.local.set({ tasks: [task, ...tasks].slice(0, 100) });
        throw Error('计划已记录，但定时器创建失败；请重新保存');
      }
      await record('已保存开售提醒计划（不自动下单）');
      return { ok: true, taskId: task.taskId };
    }
    if (message.type === 'CANCEL') {
      const { tasks = [] } = await chrome.storage.local.get('tasks');
      const task = tasks.find(task => task.taskId === message.taskId);
      if (task) {
        task.state = 'cancelled';
        await chrome.storage.local.set({ tasks });
        await chrome.alarms.clear(task.taskId);
      }
      return { ok: true };
    }
    if (message.type === 'RETRY_NOTIFICATION') {
      const { tasks = [] } = await chrome.storage.local.get('tasks');
      const task = tasks.find(task => task.taskId === message.taskId && task.state === 'notification-failed');
      if (!task) throw Error('这条记录不能重试通知');
      await notifyTask(task, tasks);
      return { ok: true };
    }
    if (message.type === 'CLEAR_CATALOG') {
      await chrome.storage.local.set({ catalog: [] });
      return { ok: true };
    }
    throw Error('未知操作');
  }).then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
async function notifyTask(task, tasks) {
  task.state = 'notifying';
  await chrome.storage.local.set({ tasks });
  try {
    await chrome.notifications.create(task.taskId, {
      type: 'basic', iconUrl: 'icon.png', title: '开售时间已到',
      message: task.title + '：请到官方页面确认是否开售。当前版本不自动下单。'
    });
    task.state = 'notified';
  } catch {
    task.state = 'notification-failed';
  }
  await chrome.storage.local.set({ tasks });
  await chrome.action.setBadgeText({ text: task.state === 'notified' ? '到点' : '!' });
  await record(task.state === 'notified' ? '通知已提交系统，请到官方页面核对' : '系统通知失败，请检查通知权限后手动重试');
}
async function due(name) {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const task = tasks.find(task => task.taskId === name && task.state === 'scheduled');
  if (!task) return;
  if (task.opensAt > Date.now()) {
    await chrome.alarms.create(task.taskId, { when: task.opensAt }); return;
  }
  await notifyTask(task, tasks);
}
async function recover() {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  let changed = false;
  for (const task of tasks) {
    if (task.state === 'notifying') { task.state = 'notification-unknown'; changed = true; }
  }
  if (changed) await chrome.storage.local.set({ tasks });
  for (const task of tasks.filter(task => task.state === 'scheduled')) {
    try {
      if (!TicketCatalog.itemURL(task.url) || !Number.isFinite(task.opensAt)) throw Error('invalid task');
      if (task.opensAt <= Date.now()) await due(task.taskId);
      else if (!(await chrome.alarms.get(task.taskId))) await chrome.alarms.create(task.taskId, { when: task.opensAt });
    } catch { await record('有提醒未能恢复，请查看诊断信息'); }
  }
}
chrome.alarms.onAlarm.addListener(alarm => serial(() => due(alarm.name)));
chrome.notifications.onClicked.addListener(id => serial(async () => {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const item = TicketCatalog.itemURL(tasks.find(task => task.taskId === id)?.url);
  if (item) await chrome.tabs.create({ url: item.url });
}));
chrome.runtime.onStartup.addListener(() => serial(recover));
chrome.runtime.onInstalled.addListener(() => serial(recover));
// Alarm persistence is not guaranteed across extension updates / worker starts.
serial(recover).catch(() => {});
