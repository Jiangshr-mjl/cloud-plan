import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PLANNER_TEST_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Tests write fixtures; only local hosts are permitted.');
const key = (await readFile('outputs/access-key.txt', 'utf8')).trim();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
await mkdir('tests/output', { recursive: true });
async function api(body, secret = key) {
  const response = await fetch(`${base}/api/planner`, { method: body ? 'POST' : 'GET', headers: { 'X-Planner-Key': secret, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}
const backup = tasks => ({ format: 'daylight-planner', schemaVersion: 1, timezone: 'Asia/Shanghai', exportedAt: new Date().toISOString(), tasks });
const record = [];
const check = (label, value) => { assert.ok(value, label); record.push(label); console.log('PASS ' + label); };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
async function saveDialog() { await page.getByRole('button', { name: '保存任务', exact: true }).click(); await page.locator('dialog').waitFor({ state: 'detached' }); }
async function nav(name) { await page.getByRole('navigation').getByRole('button', { name, exact: name !== '每日计划' }).click(); }
async function dragGoal(title, target) {
  const handle = await page.getByRole('button', { name: `拖动：${title}`, exact: true }).boundingBox();
  const zone = await page.locator(`[data-quadrant="${target}"] .quadrant-heading`).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 12 }); await page.mouse.up();
  await page.locator(`[data-quadrant="${target}"]`).getByRole('button', { name: title, exact: true }).waitFor();
}
try {
  check('缺失及错误密钥均返回 401', (await api(undefined, '')).status === 401 && (await api(undefined, 'wrong'.repeat(10))).status === 401);
  const initial = await api(); check('真实 D1 读取成功', initial.status === 200);
  check('本地测试数据库清理成功', (await api({ revision: initial.data.revision, operation: { type: 'import', backup: backup([]) } })).status === 200);
  await page.goto(base); await page.getByRole('heading', { name: '回到你的计划' }).waitFor();
  await page.screenshot({ path: 'tests/output/welcome.png', fullPage: true });
  await page.getByLabel('访问密钥', { exact: true }).fill(key);
  await page.getByRole('button', { name: '打开计划表', exact: true }).click();
  await page.getByRole('heading', { name: '今天，也从容一点。' }).waitFor();
  await nav('长期任务'); await page.getByRole('button', { name: '新建长期任务', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).fill('完成论文初稿');
  await page.getByLabel('备注').fill('每天向前一步，把想法慢慢写清楚。');
  await page.getByRole('radio', { name: '重要不紧急', exact: true }).check(); await saveDialog();
  check('无截止日期可创建长期任务', (await api()).data.tasks.find(t => t.kind === 'goal').dueDate === null);
  await dragGoal('完成论文初稿', 3); await dragGoal('完成论文初稿', 0); await dragGoal('完成论文初稿', 1);
  check('桌面拖动跨象限保存分类', (await api()).data.tasks.find(t => t.kind === 'goal').urgent === false);
  await page.getByRole('button', { name: '完成论文初稿', exact: true }).click();
  await page.getByRole('button', { name: '添加子任务', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).fill('写完论文引言');
  await page.getByLabel('计划日期').fill(today); await saveDialog();
  await nav('每日计划'); await page.getByRole('button', { name: '完成：写完论文引言', exact: true }).click();
  await page.getByRole('button', { name: '取消完成：写完论文引言', exact: true }).waitFor();
  await nav('长期任务'); await page.getByText('1 / 1 步已完成', { exact: true }).waitFor();
  const linked = (await api()).data.tasks;
  check('子任务跨视图完成并更新进度，没有重复记录', linked.length === 2 && linked.find(t => t.kind === 'step').completedAt !== null);
  await nav('完成记录'); await page.getByRole('button', { name: '取消完成：写完论文引言', exact: true }).click();
  await page.getByText('这里会记下你的每一份努力', { exact: true }).waitFor();
  check('完成记录可撤销完成', !(await api()).data.tasks.find(t => t.kind === 'step').completedAt);
  await nav('每日计划');
  for (const name of ['整理本周文献笔记', '散步二十分钟', '给明天留一点时间']) {
    await page.getByRole('button', { name: '添加任务', exact: true }).click(); await page.getByLabel('任务名称', { exact: true }).fill(name); await saveDialog();
  }
  await page.getByRole('button', { name: '上移：散步二十分钟', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.topbar .spin'));
  check('顺序保存到数据库', (await api()).data.tasks.find(t => t.title === '散步二十分钟').order < (await api()).data.tasks.find(t => t.title === '整理本周文献笔记').order);
  await page.getByRole('button', { name: '编辑：整理本周文献笔记', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).fill('整理文献笔记（保留的草稿）');
  const state = (await api()).data;
  await api({ revision: state.revision, operation: { type: 'edit', id: state.tasks.find(t => t.title === '整理本周文献笔记').id, changes: { notes: '另一设备刚刚编辑' } } });
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await page.locator('dialog').getByText('尚未保存', { exact: true }).waitFor();
  check('跨设备冲突保留编辑草稿', await page.getByLabel('任务名称', { exact: true }).inputValue() === '整理文献笔记（保留的草稿）');
  await page.locator('dialog').getByRole('button', { name: '加载最新，保留草稿' }).click();
  await page.getByRole('button', { name: '保存任务', exact: true }).waitFor({ state: 'visible' }); await saveDialog();
  await page.getByRole('button', { name: '添加任务', exact: true }).click(); await page.getByLabel('任务名称', { exact: true }).fill('断网后保留的小事');
  await context.setOffline(true); await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await page.locator('dialog').getByText('尚未保存', { exact: true }).waitFor();
  check('断网不会显示保存成功且保留草稿', await page.getByLabel('任务名称', { exact: true }).inputValue() === '断网后保留的小事');
  await context.setOffline(false); await page.locator('dialog').getByRole('button', { name: '重试保存', exact: true }).click(); await page.locator('dialog').waitFor({ state: 'detached' });
  const context2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await context2.newPage(); await mobile.goto(base); await mobile.getByLabel('访问密钥', { exact: true }).fill(key); await mobile.getByRole('button', { name: '打开计划表', exact: true }).click();
  await mobile.getByRole('button', { name: '编辑：断网后保留的小事', exact: true }).waitFor();
  check('第二设备读取同步数据', true);
  await page.getByRole('button', { name: '完成：散步二十分钟', exact: true }).click();
  await mobile.getByRole('button', { name: '取消完成：散步二十分钟', exact: true }).waitFor({ timeout: 22000 });
  check('另一设备 15 秒轮询自动更新', true);
  await page.screenshot({ path: 'tests/output/desktop-daily.png', fullPage: true });
  await mobile.screenshot({ path: 'tests/output/mobile-daily.png', fullPage: true });
  for (const name of ['长期任务', '完成记录', '设置与备份', '每日计划']) {
    await mobile.getByRole('navigation').getByRole('button', { name, exact: name !== '每日计划' }).click();
    check(`手机 ${name} 无横向溢出`, await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await mobile.getByRole('navigation').getByRole('button', { name: '长期任务', exact: true }).click();
  check('手机同时展示四个象限', await mobile.locator('[data-quadrant]:visible').count() === 4);
  const touchSession = await context2.newCDPSession(mobile);
  async function touchDrag(target) {
    const handle = await mobile.getByRole('button', { name: '拖动：完成论文初稿', exact: true }).boundingBox();
    const zone = await mobile.locator(`[data-quadrant="${target}"] .quadrant-heading`).boundingBox();
    const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 }] });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.locator(`[data-quadrant="${target}"]`).getByRole('button', { name: '完成论文初稿', exact: true }).waitFor();
  }
  await touchDrag(0); await touchDrag(1); await touchSession.detach();
  check('手机触屏拖动跨象限', (await api()).data.tasks.find(t => t.kind === 'goal').urgent === false);
  await mobile.screenshot({ path: 'tests/output/mobile-goals.png', fullPage: true });
  await mobile.getByRole('button', { name: '列表', exact: true }).click();
  await mobile.getByRole('region', { name: '长期任务列表' }).waitFor();
  await mobile.getByRole('button', { name: '完成论文初稿', exact: true }).click();
  await mobile.getByRole('button', { name: '编辑任务', exact: true }).waitFor();
  check('手机列表视图展开后无横向溢出', await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ path: 'tests/output/mobile-goals-list.png', fullPage: true }); await context2.close();
  await nav('长期任务');
  const refreshed = page.waitForResponse(r => r.url().endsWith('/api/planner') && r.request().method() === 'GET');
  await page.getByTitle('刷新云端数据').click(); await refreshed;
  await page.getByText('已加载最新计划。草稿已保留，请核对后重新保存。', { exact: true }).waitFor();
  await page.screenshot({ path: 'tests/output/desktop-goals.png', fullPage: true });
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.getByRole('region', { name: '长期任务列表' }).waitFor();
  check('列表显示全部进行中目标', await page.locator('.list-goal-card').count() === (await api()).data.tasks.filter(t => t.kind === 'goal' && !t.completedAt).length);
  await page.getByRole('button', { name: '完成：写完论文引言', exact: true }).click();
  await page.getByText('1 / 1 步已完成', { exact: true }).waitFor();
  await page.getByRole('button', { name: '四象限', exact: true }).click();
  await page.getByText('1 / 1 步已完成', { exact: true }).waitFor();
  check('列表完成子任务后四象限同步进度', !!(await api()).data.tasks.find(t => t.kind === 'step').completedAt);
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.reload(); await nav('长期任务');
  await page.getByRole('region', { name: '长期任务列表' }).waitFor();
  check('刷新后记住长期任务列表视图', await page.getByRole('button', { name: '列表', exact: true }).getAttribute('aria-pressed') === 'true');
  await page.getByRole('button', { name: '完成论文初稿', exact: true }).click();
  await page.getByRole('button', { name: '编辑任务', exact: true }).click();
  await page.getByLabel('备注').fill('列表与四象限共用同一份计划。'); await saveDialog();
  check('列表视图可以编辑任务', (await api()).data.tasks.find(t => t.kind === 'goal').notes === '列表与四象限共用同一份计划。');
  await page.screenshot({ path: 'tests/output/desktop-goals-list.png', fullPage: true });
  const deadline = days => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  for (const [title, category, days, target] of [['准备项目汇报', '重要不紧急', 7, 0], ['整理订阅清单', '不重要不紧急', 3, 2]]) {
    await page.getByRole('button', { name: '新建长期任务', exact: true }).click();
    await page.getByLabel('任务名称', { exact: true }).fill(title);
    await page.getByLabel('截止日期').fill(deadline(days)); await page.getByRole('radio', { name: category, exact: true }).check(); await saveDialog();
    await page.getByRole('button', { name: '四象限', exact: true }).click();
    await page.locator(`[data-quadrant="${target}"]`).getByRole('button', { name: title, exact: true }).waitFor();
  }
  check('截止 7 天与 3 天任务自动进入对应紧急象限', (await api()).data.tasks.filter(t => t.kind === 'goal' && t.urgent).length === 2);
  await page.screenshot({ path: 'tests/output/desktop-matrix.png', fullPage: true });
  await nav('设置与备份');
  const exportEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '导出备份', exact: true }).click(); const exported = await exportEvent;
  await exported.saveAs('tests/output/backup.json'); const restored = JSON.parse(await readFile('tests/output/backup.json', 'utf8'));
  check('备份包含所有关联任务', restored.tasks.length === (await api()).data.tasks.length);
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await page.getByText('文件格式、日期或子任务关联无效。现有数据未改变。', { exact: true }).waitFor();
  const beforeImport = (await api()).data.revision;
  await page.locator('input[type=file]').setInputFiles('tests/output/backup.json');
  await page.getByRole('heading', { name: '备份校验通过' }).waitFor();
  const autoBackupEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '备份当前数据并替换', exact: true }).click(); await autoBackupEvent;
  await page.getByRole('heading', { name: '备份校验通过' }).waitFor({ state: 'detached' });
  check('导入前下载备份且原子替换', (await api()).data.revision === beforeImport + 1);
  const race = (await api()).data; const raceBody = { revision: race.revision, operation: { type: 'schedule', ids: [race.tasks.find(t => t.kind === 'daily').id], date: today } };
  const results = await Promise.all([api(raceBody), api(raceBody)]);
  check('真实 D1 并发更新只有一个成功', results.map(r => r.status).sort().join(',') === '200,409');
  await page.getByRole('button', { name: '忘记本机密钥', exact: true }).click(); await page.getByRole('heading', { name: '回到你的计划' }).waitFor();
  check('忘记密钥清除本机访问，不删除数据', (await api()).data.tasks.length > 0 && await page.evaluate(() => localStorage.getItem('daylight.access-key')) === null);
  check('无浏览器运行时错误', errors.length === 0);
  await writeFile('tests/output/results.json', JSON.stringify({ passed: record, errors }, null, 2));
} finally { await browser.close(); }
