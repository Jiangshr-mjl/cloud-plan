import { applyOperation, requestSchema, type Snapshot } from "./planner";

export interface Store {
  read(): Promise<Snapshot>;
  write(expected: number, next: Snapshot): Promise<boolean>;
}
const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };
function json(data: unknown, status = 200) { return Response.json(data, { status, headers }); }
export async function hashKey(key: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))), b => b.toString(16).padStart(2, "0")).join("");
}
export async function handlePlanner(request: Request, expectedHash: string | undefined, store: Store) {
  if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) return json({ error: "服务尚未配置访问密钥" }, 503);
  const key = request.headers.get("X-Planner-Key") ?? "";
  const actual = await hashKey(key);
  let difference = actual.length ^ expectedHash.length;
  for (let i = 0; i < expectedHash.length; i++) difference |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  if (key.length < 6 || key.length > 256 || difference !== 0) return json({ error: "密钥无效，请重新输入" }, 401);
  try {
    if (request.method === "GET") return json(await store.read());
    if (request.method !== "POST") return json({ error: "不支持此操作" }, 405);
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return json({ error: "请求来源无效" }, 403);
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "请提交 JSON 数据" }, 415);
    if (Number(request.headers.get("Content-Length")) > 4_000_000) return json({ error: "数据文件过大" }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 4_000_000) return json({ error: "数据文件过大" }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "JSON 格式无效" }, 400); }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "数据格式无效" }, 400);
    const current = await store.read();
    if (current.revision !== parsed.data.revision) return json({ error: "其他设备已更新计划。你的输入已保留，请加载最新版本后再保存。" }, 409);
    let next: Snapshot;
    try { next = { revision: current.revision + 1, tasks: applyOperation(current.tasks, parsed.data.operation, current.revision + 1) }; }
    catch (error) { return json({ error: error instanceof Error ? error.message : "任务数据无效" }, 400); }
    if (new TextEncoder().encode(JSON.stringify(next.tasks)).length > 1_500_000) return json({ error: "任务数据已达容量上限，请备份后整理历史记录" }, 413);
    if (!await store.write(current.revision, next)) return json({ error: "其他设备刚刚更新了计划。输入已保留，请加载最新版本。" }, 409);
    return json(next);
  } catch {
    // Never include request headers, secrets or database errors in responses/logs.
    return json({ error: "暂时无法连接云端，请稍后重试" }, 503);
  }
}
