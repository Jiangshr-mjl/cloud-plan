import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { applyOperation, backupSchema, beijingDate, weekStart, isDailyTask, makeBackup, promoteUrgency, quadrant, type Task, type Snapshot } from "../lib/planner";
import { handlePlanner, hashKey, type Store } from "../lib/api";
import { DailyQueue } from "../lib/daily-queue";

const now = "2026-10-19T12:00:00.000Z";
test("周计划按周一归属，跨月跨年稳定且不计入每日任务", () => {
  assert.equal(weekStart("2026-10-25"), "2026-10-19");
  assert.equal(weekStart("2026-10-26"), "2026-10-26");
  assert.equal(weekStart("2027-01-01"), "2026-12-28");
  const weekly = task({ kind: "weekly" });
  assert.equal(isDailyTask(weekly), false);
  assert.equal(backupSchema.safeParse(makeBackup([task({ kind: "weekly", plannedDate: "2026-10-20" })])).success, false);
  assert.equal(backupSchema.safeParse(makeBackup([task({ kind: "weekly", plannedDate: "bad" })])).success, false);
  const [moved] = applyOperation([weekly], { type: "schedule", ids: [weekly.id], date: "2027-01-01" }, 2, now);
  assert.equal(moved.plannedDate, "2026-12-28");
  const [done] = applyOperation([moved], { type: "complete", id: moved.id, done: true }, 3, now);
  assert.deepEqual(backupSchema.parse(makeBackup([done])).tasks, [done]);
  assert.equal(applyOperation([done], { type: "complete", id: done.id, done: false }, 4, now)[0].completedAt, null);
});
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail("Queue did not settle");
}
function creation(t: Task) { const { version, createdAt, updatedAt, completedAt, ...value } = t; return { type: "create" as const, task: value }; }
test("连续新增和排序立即投影，串行响应不会把界面退回旧顺序", async () => {
  const a = task(), b = task(); let server: Snapshot = { revision: 0, tasks: [] }; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); let first = true, active = 0, maxActive = 0;
  let current: any; const orders: string[][] = [];
  const queue = new DailyQueue(server, async payload => {
    if (!payload) return server;
    active++; maxActive = Math.max(maxActive, active);
    if (first) { first = false; await gate; }
    assert.equal(payload.revision, server.revision);
    server = { revision: server.revision + 1, tasks: applyOperation(server.tasks, payload.operation, server.revision + 1) };
    active--; return server;
  }, state => { current = state; orders.push([...state.snapshot.tasks].sort((x,y) => x.order-y.order).map(t => t.id)); });
  queue.enqueue(creation(a)); queue.enqueue(creation(b)); queue.enqueue({ type: "reorder", ids: [b.id, a.id] });
  assert.equal(server.tasks.length, 0); assert.equal(current.count, 3);
  const start = orders.length; assert.deepEqual(orders.at(-1), [b.id, a.id]);
  release(); await until(() => current.count === 0 && !current.active);
  assert.equal(maxActive, 1); assert.equal(server.revision, 3);
  for (const order of orders.slice(start)) assert.deepEqual(order, [b.id, a.id]);
});
test("响应丢失后重试确认已写入，不重复创建且继续后续队列", async () => {
  let server: Snapshot = { revision: 0, tasks: [] }, lost = true; let current: any; let posts = 0;
  const queue = new DailyQueue(server, async payload => {
    if (!payload) return server;
    posts++; assert.equal(payload.revision, server.revision);
    server = { revision: server.revision + 1, tasks: applyOperation(server.tasks, payload.operation, server.revision + 1) };
    if (lost) { lost = false; throw new Error("Response lost"); } return server;
  }, state => { current = state; });
  queue.enqueue(creation(task())); queue.enqueue(creation(task()));
  await until(() => !!current.error); assert.equal(current.snapshot.tasks.length, 2);
  await queue.retry(); await until(() => current.count === 0 && !current.active);
  assert.equal(posts, 2); assert.equal(server.tasks.length, 2);
});
test("队列冲突停止保存，显式加载最新后核对重试保留另一设备数据", async () => {
  const original = task(); let server: Snapshot = { revision: 1, tasks: [original] }; let current: any;
  const queue = new DailyQueue(server, async payload => {
    if (!payload) return server;
    if (payload.revision !== server.revision) throw Object.assign(new Error("Conflict"), { status: 409 });
    server = { revision: server.revision + 1, tasks: applyOperation(server.tasks, payload.operation, server.revision + 1) }; return server;
  }, state => { current = state; });
  server = { revision: 2, tasks: [{ ...original, title: "另一设备修改" }] };
  queue.enqueue(creation(task())); await until(() => !!current.error);
  await queue.retry(); assert.equal(current.conflict, true); assert.equal(server.revision, 2);
  await queue.reload(); assert.equal(current.count, 1); assert.equal(current.snapshot.tasks[0].title, "另一设备修改"); assert.equal(server.revision, 2);
  await queue.retry(); await until(() => current.count === 0 && !current.active);
  assert.equal(server.tasks[0].title, "另一设备修改"); assert.equal(server.tasks.length, 2);
});
function task(overrides: Partial<Task> = {}): Task { return { id: randomUUID(), kind: "daily", parentId: null, title: "写引言", notes: "", plannedDate: "2026-10-19", dueDate: "2026-10-21", important: true, urgent: false, order: 1, completedAt: null, createdAt: now, updatedAt: now, version: 1, ...overrides }; }
test("关联子任务改期不复制、不改变截止日期或象限", () => {
  const goal = task({ kind: "goal", plannedDate: null }); const step = task({ kind: "step", parentId: goal.id });
  const next = applyOperation([goal, step], { type: "schedule", ids: [step.id], date: "2026-10-22" }, 2);
  assert.equal(next.length, 2); assert.equal(next[1].plannedDate, "2026-10-22"); assert.equal(next[1].dueDate, step.dueDate); assert.equal(quadrant(next[0]), 1);
  assert.equal(step.plannedDate, "2026-10-19");
});
test("实际完成时间、取消完成，以及长期任务确认", () => {
  const goal = task({ kind: "goal", plannedDate: null }); const step = task({ kind: "step", parentId: goal.id });
  assert.throws(() => applyOperation([goal, step], { type: "complete", id: goal.id, done: true }, 2));
  const done = applyOperation([goal, step], { type: "complete", id: step.id, done: true }, 2, now);
  assert.equal(done[1].completedAt, now); assert.equal(done[0].completedAt, null);
  assert.equal(applyOperation(done, { type: "complete", id: step.id, done: false }, 3)[1].completedAt, null);
});
test("删除长期任务同时删除子任务，其他任务保留", () => {
  const goal = task({ kind: "goal", plannedDate: null }); const step = task({ kind: "step", parentId: goal.id }); const other = task();
  assert.deepEqual(applyOperation([goal, step, other], { type: "delete", id: goal.id }, 2), [other]);
});
test("备份往返与非法关联、日期、重复 ID 校验", () => {
  const a = task(); assert.deepEqual(backupSchema.parse(makeBackup([a])).tasks, [a]);
  for (const items of [[a, a], [task({ plannedDate: "2026-02-30" })], [task({ kind: "step", parentId: randomUUID() })]]) assert.equal(backupSchema.safeParse(makeBackup(items)).success, false);
});
test("北京时间跨日", () => { assert.equal(beijingDate(new Date("2026-10-19T16:01:00Z")), "2026-10-20"); });
test("批量操作失败不部分修改", () => {
  const a = task(); assert.throws(() => applyOperation([a], { type: "schedule", ids: [a.id, randomUUID()], date: "2026-10-20" }, 2)); assert.equal(a.plannedDate, "2026-10-19");
});
test("紧急性按北京时间在 7 / 3 天边界升级，包含逾期，无日期不升级", () => {
  const cases: [boolean, string | null, boolean][] = [
    [true, "2026-10-28", false], [true, "2026-10-27", true],
    [false, "2026-10-24", false], [false, "2026-10-23", true],
    [false, "2026-10-20", true], [true, "2026-10-01", true],
    [true, null, false], [false, null, false],
  ];
  for (const [important, dueDate, urgent] of cases) {
    const original = task({ kind: "goal", plannedDate: null, important, dueDate });
    const [result] = promoteUrgency([original], 9, "2026-10-19T16:00:00.000Z");
    assert.equal(result.urgent, urgent); assert.equal(result.important, important);
    assert.equal(result.dueDate, dueDate); assert.equal(original.urgent, false);
    if (urgent) assert.equal(result.version, 9);
  }
});
test("自动升级跳过已完成及每日任务，不自动降级，重复执行不产生修改", () => {
  const items = [task({ kind: "goal", plannedDate: null, completedAt: now }), task(), task({ kind: "goal", plannedDate: null, urgent: true, dueDate: null })];
  assert.equal(promoteUrgency(items, 2, now), items);
  const first = promoteUrgency([task({ kind: "goal", plannedDate: null })], 2, now);
  assert.equal(promoteUrgency(first, 3, now), first);
});
function memory(): Store { let data: Snapshot = { revision: 0, tasks: [] }; return { async read() { return structuredClone(data); }, async write(expected, next) { if (data.revision !== expected) return false; data = structuredClone(next); return true; } }; }
const key = "test-only-" + "k".repeat(40);
test("读取自动升级原子保存，旧版本写入冲突，空截止日期可保存", async () => {
  const store = memory(); const hash = await hashKey(key);
  const goal = task({ kind: "goal", plannedDate: null, dueDate: "2000-01-01" });
  await store.write(0, { revision: 1, tasks: [goal] });
  const responses = await Promise.all([handlePlanner(req(), hash, store), handlePlanner(req(), hash, store)]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  assert.equal((await store.read()).revision, 2); assert.equal((await store.read()).tasks[0].urgent, true);
  assert.equal((await handlePlanner(req({ revision: 1, operation: { type: "edit", id: goal.id, changes: { title: "旧编辑" } } }), hash, store)).status, 409);
  const saved = await handlePlanner(req({ revision: 2, operation: { type: "edit", id: goal.id, changes: { dueDate: null, urgent: false } } }), hash, store);
  assert.equal(saved.status, 200); assert.equal((await store.read()).tasks[0].urgent, false);
});
test("保存时规则优先于拖动的非紧急选择", async () => {
  const store = memory(); const hash = await hashKey(key);
  const goal = task({ kind: "goal", plannedDate: null, dueDate: "2000-01-01", important: false });
  await store.write(0, { revision: 1, tasks: [goal] });
  const response = await handlePlanner(req({ revision: 1, operation: { type: "edit", id: goal.id, changes: { urgent: false } } }), hash, store);
  assert.equal(response.status, 200); assert.equal((await store.read()).tasks[0].urgent, true);
});
test("32 位密钥可验证，错误密钥及旧短密钥拒绝访问", async () => {
  const store = memory(); const shortKey = "Abcd2345".repeat(4);
  assert.equal((await handlePlanner(req(undefined, shortKey), await hashKey(shortKey), store)).status, 200);
  assert.equal((await handlePlanner(req(undefined, "Abcd2346".repeat(4)), await hashKey(shortKey), store)).status, 401);
  assert.equal((await handlePlanner(req(undefined, "Abcd2345"), await hashKey("Abcd2345"), store)).status, 401);
});
function req(body?: unknown, secret = key) { return new Request("https://planner.test/api/planner", { method: body ? "POST" : "GET", headers: { "X-Planner-Key": secret, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); }
test("无密钥、错误密钥、未配置服务均不访问数据库", async () => {
  const store: Store = { read: async () => { throw new Error("must not read"); }, write: async () => { throw new Error("must not write"); } }; const hash = await hashKey(key);
  assert.equal((await handlePlanner(req(undefined, ""), hash, store)).status, 401);
  assert.equal((await handlePlanner(req(undefined, "x".repeat(40)), hash, store)).status, 401);
  assert.equal((await handlePlanner(req(), undefined, store)).status, 503);
});
test("并发写入只能成功一次，旧版本返回 409", async () => {
  const store = memory(); const hash = await hashKey(key); const data = makeBackup([task()]);
  const body = { revision: 0, operation: { type: "import", backup: data } };
  const results = await Promise.all([handlePlanner(req(body), hash, store), handlePlanner(req(body), hash, store)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal((await store.read()).revision, 1);
  assert.equal((await handlePlanner(req(body), hash, store)).status, 409);
});
test("导入无效备份不修改已有数据；响应禁用缓存", async () => {
  const store = memory(); const hash = await hashKey(key);
  const result = await handlePlanner(req({ revision: 0, operation: { type: "import", backup: { ...makeBackup([task()]), schemaVersion: 2 } } }), hash, store);
  assert.equal(result.status, 400); assert.equal((await store.read()).revision, 0);
  assert.match((await handlePlanner(req(), hash, store)).headers.get("Cache-Control")!, /no-store/);
});

 test("习惯打卡幂等、补打、撤销、未来日期拒绝和备份恢复", () => {
 const today=beijingDate();const h=task({kind:'habit',plannedDate:today,dueDate:null,habit:{checks:[],reminder:'20:00'}});
 const checked=applyOperation([h],{type:'habitCheck',id:h.id,date:today,done:true},2);
 const again=applyOperation(checked,{type:'habitCheck',id:h.id,date:today,done:true},3);
 assert.deepEqual(again[0].habit?.checks,[today]);
 assert.deepEqual(backupSchema.parse(makeBackup(again)).tasks,again);
 assert.deepEqual(applyOperation(again,{type:'habitCheck',id:h.id,date:today,done:false},4)[0].habit?.checks,[]);
 const tomorrow=new Date(today+'T12:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
 assert.throws(()=>applyOperation([h],{type:'habitCheck',id:h.id,date:tomorrow.toISOString().slice(0,10),done:true},5));
 assert.throws(()=>applyOperation([h],{type:'complete',id:h.id,done:true},5));
 const start=new Date(today+'T12:00Z');start.setUTCDate(start.getUTCDate()-20);const old=task({kind:'habit',plannedDate:start.toISOString().slice(0,10),dueDate:null,habit:{checks:[],reminder:null}});
 assert.equal(applyOperation([old],{type:'habitCheck',id:old.id,date:old.plannedDate!,done:true},2)[0].habit?.checks.length,1);
 start.setUTCDate(start.getUTCDate()-1);assert.throws(()=>applyOperation([old],{type:'habitCheck',id:old.id,date:start.toISOString().slice(0,10),done:true},2));
 });


test("周目标子任务创建、安排、完成与备份保留同一条关联记录", () => {
  const weekly = task({ kind: "weekly", plannedDate: "2026-10-19" });
  const step = task({ kind: "step", parentId: weekly.id, plannedDate: null });
  let items = applyOperation([weekly], creation(step), 2, now);
  assert.equal(isDailyTask(items[1]), true);
  for (const date of ["2026-10-20", "2026-10-20", "2026-10-22"]) {
    items = applyOperation(items, { type: "schedule", ids: [step.id], date }, 3, now);
    assert.equal(items.length, 2);
    assert.equal(items[1].plannedDate, date);
    assert.equal(items[1].parentId, weekly.id);
    assert.equal(items[1].dueDate, step.dueDate);
    assert.equal(items[0].plannedDate, "2026-10-19");
  }
  assert.throws(() => applyOperation(items, { type: "complete", id: weekly.id, done: true }, 4, now));
  const forced = applyOperation(items, { type: "complete", id: weekly.id, done: true, confirmIncomplete: true }, 4, now);
  assert.equal(forced[1].completedAt, null);
  items = applyOperation(items, { type: "complete", id: step.id, done: true }, 4, now);
  assert.equal(items[1].completedAt, now);
  assert.equal(items[0].completedAt, null);
  assert.deepEqual(backupSchema.parse(makeBackup(items)).tasks, items);
  assert.equal(applyOperation(items, { type: "complete", id: step.id, done: false }, 5, now)[1].completedAt, null);
  assert.deepEqual(applyOperation(items, { type: "delete", id: weekly.id }, 5, now), []);
});
test("子任务只允许关联长期任务或周目标，拒绝多层或其他类型关联", () => {
  const goal = task({ kind: "goal", plannedDate: null });
  const parents = [task(), task({ kind: "step", parentId: goal.id }), task({ kind: "habit", dueDate: null, habit: { checks: [], reminder: null } })];
  for (const parent of parents) {
    const existing = [goal, parent];
    assert.equal(backupSchema.safeParse(makeBackup(existing)).success, true);
    const child = task({ kind: "step", parentId: parent.id, plannedDate: null });
    assert.equal(backupSchema.safeParse(makeBackup([...existing, child])).success, false);
  }
});

test("多层项目保留关联、周目标不复制、删除清理全部后代且拒绝循环", () => {
 const root=task({kind:"goal",plannedDate:null}); const child=task({kind:"goal",parentId:root.id,plannedDate:null}); const leaf=task({kind:"step",parentId:child.id,plannedDate:null});
 const items=[root,child,leaf]; assert.deepEqual(backupSchema.parse(makeBackup(items)).tasks,items);
 const weekly=applyOperation(items,{type:"edit",id:root.id,changes:{weekDate:"2026-10-19"}},2,now);
 assert.equal(weekly.length,3); assert.equal(weekly[0].weekDate,"2026-10-19"); assert.equal(weekly[1].parentId,root.id);
 assert.throws(()=>applyOperation(items,{type:"complete",id:root.id,done:true},2,now));
 assert.deepEqual(applyOperation(items,{type:"delete",id:root.id},2,now),[]);
 assert.equal(backupSchema.safeParse(makeBackup([{...root,parentId:child.id},child,leaf])).success,false);
 assert.equal(promoteUrgency(items,2,now)[2].urgent,true);
 assert.throws(()=>applyOperation(items,{type:"edit",id:root.id,changes:{weekDate:"2026-10-20"}},2,now));
});
