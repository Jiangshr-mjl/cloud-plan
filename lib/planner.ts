import { z } from "zod";

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= "2200-12-31";
}, "日期无效");
export const taskSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["daily", "goal", "step", "weekly", "habit"]),
  habit: z.object({checks:z.array(dateSchema).max(21),reminder:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()}).strict().optional(),
  parentId: z.string().uuid().nullable(),
  title: z.string().trim().min(1, "请填写任务名称").max(160),
  notes: z.string().max(10000),
  plannedDate: dateSchema.nullable(),
  dueDate: dateSchema.nullable(),
  focusDate: dateSchema.nullable().optional(),
  important: z.boolean(),
  urgent: z.boolean(),
  order: z.number().int().nonnegative().max(1000000),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().nonnegative(),
}).strict();
export type Task = z.infer<typeof taskSchema>;
export type Snapshot = { revision: number; tasks: Task[] };
export const tasksSchema = z.array(taskSchema).max(10000).superRefine((tasks, ctx) => {
  const ids = new Set(tasks.map(t => t.id));
  const parents = new Set(tasks.filter(t => t.kind === "goal" || t.kind === "weekly").map(t => t.id));
  if (ids.size !== tasks.length) ctx.addIssue({ code: "custom", message: "任务 ID 重复" });
  for (const t of tasks) {
    if ((t.kind === "step" && (!t.parentId || !parents.has(t.parentId))) || (t.kind !== "step" && t.parentId !== null)) ctx.addIssue({ code: "custom", message: "子任务关联无效" });
    if(t.kind === "habit") {
      if(!t.habit || !t.plannedDate || t.completedAt || t.dueDate) ctx.addIssue({code:"custom",message:"习惯数据无效"});
      if(t.habit && t.plannedDate) {
        if(new Set(t.habit.checks).size !== t.habit.checks.length || t.habit.checks.some(d=>d<t.plannedDate! || d>habitDate(t.plannedDate!,20) || d>beijingDate())) ctx.addIssue({code:"custom",message:"打卡日期无效或重复"});
      }
    } else if(t.habit) ctx.addIssue({code:"custom",message:"仅习惯可保存打卡记录"});
    if (t.kind === "daily" && !t.plannedDate) ctx.addIssue({ code: "custom", message: "每日任务需要计划日期" });
    if (t.kind === "weekly" && (!t.plannedDate || weekStart(t.plannedDate) !== t.plannedDate)) ctx.addIssue({ code: "custom", message: "周计划需要以周一作为所属周日期" });
    if (t.kind === "goal" && t.plannedDate) ctx.addIssue({ code: "custom", message: "请安排长期任务的子任务" });
  }
});
export const backupSchema = z.object({
  format: z.literal("daylight-planner"), schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(), timezone: z.literal("Asia/Shanghai"), tasks: tasksSchema,
}).strict();
const editableSchema = taskSchema.pick({ title: true, notes: true, plannedDate: true, dueDate: true, focusDate: true, important: true, urgent: true, habit: true }).partial().strict();
export const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), task: taskSchema.omit({ createdAt: true, updatedAt: true, completedAt: true, version: true }) }).strict(),
  z.object({ type: z.literal("edit"), id: z.string().uuid(), changes: editableSchema }).strict(),
  z.object({ type: z.literal("complete"), id: z.string().uuid(), done: z.boolean(), confirmIncomplete: z.boolean().optional() }).strict(),
  z.object({type:z.literal("habitCheck"),id:z.string().uuid(),date:dateSchema,done:z.boolean()}).strict(),
  z.object({ type: z.literal("delete"), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal("schedule"), ids: z.array(z.string().uuid()).min(1).max(10000), date: dateSchema }).strict(),
  z.object({ type: z.literal("reorder"), ids: z.array(z.string().uuid()).min(1).max(10000) }).strict(),
  z.object({ type: z.literal("import"), backup: backupSchema }).strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export const requestSchema = z.object({ revision: z.number().int().nonnegative(), operation: operationSchema }).strict();

export function applyOperation(tasks: Task[], op: Operation, revision: number, now = new Date().toISOString()): Task[] {
  const next = tasks.map(t => ({ ...t }));
  const find = (id: string) => { const task = next.find(t => t.id === id); if (!task) throw new Error("任务已不存在，请刷新后重试"); return task; };
  const touch = (task: Task) => { task.updatedAt = now; task.version = revision; };
  switch (op.type) {
    case "create":
      if (next.some(t => t.id === op.task.id)) throw new Error("任务已存在，请刷新核对，避免重复添加");
      next.push({ ...op.task, completedAt: null, createdAt: now, updatedAt: now, version: revision });
      break;
    case "edit": { const task = find(op.id); if(op.changes.habit && JSON.stringify(op.changes.habit.checks)!==JSON.stringify(task.habit?.checks)) throw new Error("请通过打卡按钮修改记录"); if(task.kind === "habit" && task.habit?.checks.length && op.changes.plannedDate && op.changes.plannedDate!==task.plannedDate) throw new Error("已有打卡的习惯不能修改开始日期"); Object.assign(task, op.changes); touch(task); break; }
    case "habitCheck": {
      const task=find(op.id); const date=beijingDate(new Date(now));
      if(task.kind!=="habit" || !task.habit || !task.plannedDate || op.date<task.plannedDate || op.date>habitDate(task.plannedDate,20) || op.date>date) throw new Error("只能为计划内已到来的日期打卡");
      const checks=new Set(task.habit.checks); if(op.done) checks.add(op.date); else checks.delete(op.date);
      task.habit={...task.habit,checks:[...checks].sort()};touch(task);break;
    }
    case "complete": {
      const task = find(op.id);
      if(task.kind === "habit") throw new Error("请在习惯页面打卡");
      if (op.done && (task.kind === "goal" || task.kind === "weekly") && next.some(t => t.parentId === task.id && !t.completedAt) && !op.confirmIncomplete) throw new Error("还有未完成子任务，请确认后再完成父任务");
      task.completedAt = op.done ? now : null; touch(task); break;
    }
    case "delete": return tasksSchema.parse(next.filter(t => t.id !== op.id && t.parentId !== op.id));
    case "schedule":
      for (const id of new Set(op.ids)) { const task = find(id); if (task.kind === "habit") throw new Error("请在习惯页面管理日期"); if (task.kind === "goal") throw new Error("请安排具体子任务"); task.plannedDate = task.kind === "weekly" ? weekStart(op.date) : op.date; touch(task); }
      break;
    case "reorder":
      if (new Set(op.ids).size !== op.ids.length) throw new Error("排序中有重复任务");
      op.ids.forEach((id, index) => { const task = find(id); task.order = index; touch(task); });
      break;
    case "import": return tasksSchema.parse(op.backup.tasks.map(t => ({ ...t, version: revision, updatedAt: now })));
  }
  return tasksSchema.parse(next);
}
export function beijingDate(date: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function weekStart(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
export function isDailyTask(task: Task) { return task.kind === "daily" || task.kind === "step"; }
// Escalation is one-way: changing a deadline never silently downgrades urgency.
export function promoteUrgency(tasks: Task[], revision: number, now = new Date().toISOString()): Task[] {
  const today = beijingDate(new Date(now));
  let changed = false;
  const next = tasks.map(task => {
    if (task.kind !== "goal" || task.completedAt || task.urgent || !task.dueDate) return task;
    const days = (Date.parse(task.dueDate) - Date.parse(today)) / 86400000;
    if (days > (task.important ? 7 : 3)) return task;
    changed = true;
    return { ...task, urgent: true, version: revision, updatedAt: now };
  });
  return changed ? next : tasks;
}
export function sorted(tasks: Task[]) { return [...tasks].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)); }
export function quadrant(task: Pick<Task, "important" | "urgent">) { return task.important ? (task.urgent ? 0 : 1) : (task.urgent ? 2 : 3); }
export function makeBackup(tasks: Task[]) { return { format: "daylight-planner" as const, schemaVersion: 1 as const, exportedAt: new Date().toISOString(), timezone: "Asia/Shanghai" as const, tasks }; }

export function habitDate(start:string,offset:number){const d=new Date(start+"T12:00:00Z");if(Number.isNaN(d.valueOf()))return start;d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
