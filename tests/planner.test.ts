import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { applyOperation, backupSchema, beijingDate, makeBackup, quadrant, type Task, type Snapshot } from "../lib/planner";
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
function memory(): Store { let data: Snapshot = { revision: 0, tasks: [] }; return { async read() { return structuredClone(data); }, async write(expected, next) { if (data.revision !== expected) return false; data = structuredClone(next); return true; } }; }
const key = "test-only-" + "k".repeat(40);
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
