import { env } from "cloudflare:workers";
import { handlePlanner, type Store } from "@/lib/api";
import type { Task } from "@/lib/planner";

export const dynamic = "force-dynamic";
async function handler(request: Request) {
  const store: Store = {
    async read() {
      if (!env.DB) throw new Error("Database unavailable");
      const row = await env.DB.withSession("first-primary").prepare("SELECT revision, tasks FROM planner WHERE id = 1").first<{ revision: number; tasks: string }>();
      return row ? { revision: row.revision, tasks: JSON.parse(row.tasks) as Task[] } : { revision: 0, tasks: [] };
    },
    async write(expected, next) {
      if (!env.DB) throw new Error("Database unavailable");
      // UPSERT guards both first-write races and subsequent concurrent edits.
      const result = await env.DB.prepare("INSERT INTO planner (id, revision, tasks) SELECT 1, ?, ? WHERE ? = 0 OR EXISTS (SELECT 1 FROM planner WHERE id = 1) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, tasks = excluded.tasks WHERE planner.revision = ? RETURNING revision")
        .bind(next.revision, JSON.stringify(next.tasks), expected, expected).first();
      return result !== null;
    },
  };
  return handlePlanner(request, env.PLANNER_KEY_HASH, store);
}
export const GET = handler;
export const POST = handler;
