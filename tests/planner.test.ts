import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { applyOperation, backupSchema, beijingDate, makeBackup, promoteUrgency, quadrant, type Task, type Snapshot } from "../lib/planner";
import { handlePlanner, hashKey, type Store } from "../lib/api";

const now = "2026-10-19T12:00:00.000Z";
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
test("自动升级跳过已完成及子任务，不自动降级，重复执行不产生修改", () => {
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
