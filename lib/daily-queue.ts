import { applyOperation, promoteUrgency, type Operation, type Snapshot, type Task } from "./planner";

export type DailyOperation = Extract<Operation, { type: "create" | "reorder" }>;
type QueueState = { snapshot: Snapshot; count: number; active: boolean; error: string; conflict: boolean };
type Transport = (payload?: { revision: number; operation: Operation }) => Promise<Snapshot>;
const content = (tasks: Task[]) => JSON.stringify([...tasks].sort((a, b) => a.id.localeCompare(b.id)).map(({ version, createdAt, updatedAt, ...task }) => task));

/** Local projection over the last acknowledged snapshot. Only one request writes at a time. */
export class DailyQueue {
  private base: Snapshot;
  private operations: DailyOperation[] = [];
  private running = false;
  private paused = false;
  private message = "";
  private conflict = false;
  private uncertain: Snapshot | null = null;
  constructor(base: Snapshot, private transport: Transport, private changed: (state: QueueState) => void) { this.base = base; }
  private apply(base: Snapshot, op: DailyOperation): Snapshot {
    return { revision: base.revision + 1, tasks: promoteUrgency(applyOperation(base.tasks, op, base.revision + 1), base.revision + 1) };
  }
  private projected() { return this.operations.reduce((state, op) => this.apply(state, op), this.base); }
  private emit() { this.changed({ snapshot: this.projected(), count: this.operations.length, active: this.running, error: this.message, conflict: this.conflict }); }
  enqueue(operation: DailyOperation) {
    if (this.paused) throw new Error("请先处理尚未保存的操作");
    this.apply(this.projected(), operation); // Validate before closing the form.
    this.operations.push(operation);
    this.emit();
    void this.drain();
  }
  private async drain() {
    if (this.running || this.paused || !this.operations.length) return;
    this.running = true; this.message = ""; this.conflict = false; this.emit();
    try {
      while (this.operations.length) {
        const operation = this.operations[0];
        this.uncertain = this.apply(this.base, operation);
        const result = await this.transport({ revision: this.base.revision, operation });
        this.base = result; this.operations.shift(); this.uncertain = null; this.emit();
      }
    } catch (error) {
      this.paused = true; this.message = (error as Error).message;
      this.conflict = (error as { status?: number }).status === 409;
    } finally { this.running = false; this.emit(); }
  }
  private acknowledgeIfApplied(remote: Snapshot) {
    if (this.uncertain && remote.revision === this.uncertain.revision && content(remote.tasks) === content(this.uncertain.tasks)) {
      this.operations.shift(); this.uncertain = null; this.base = remote;
      return true;
    }
    return false;
  }
  /** Verify an ambiguous response before retrying, so a committed create is not duplicated. */
  async retry() {
    if (this.running) return;
    this.running = true; this.emit();
    try {
      const remote = await this.transport();
      if (!this.acknowledgeIfApplied(remote) && remote.revision !== this.base.revision) {
        this.conflict = true;
        throw new Error("其他设备已更新计划。本机新增与排序已保留，请先加载最新数据并核对。");
      }
      this.base = remote; this.paused = false; this.message = ""; this.conflict = false;
    } catch (error) { this.paused = true; this.message = (error as Error).message; }
    finally { this.running = false; this.emit(); }
    if (!this.paused) void this.drain();
  }
  /** Explicit user action: preview pending changes over fresh data; never save automatically. */
  async reload() {
    if (this.running) return;
    this.running = true; this.emit();
    try {
      const remote = await this.transport(); this.acknowledgeIfApplied(remote);
      const operations = this.operations.filter(op => {
        if (op.type !== "create") return true;
        const existing = remote.tasks.find(task => task.id === op.task.id);
        if (!existing) return true;
        if (!Object.entries(op.task).every(([key, value]) => existing[key as keyof Task] === value)) throw new Error("云端已有同名 ID 的不同任务，请导出未保存操作后取消本机队列并核对。");
        return false;
      });
      operations.reduce((state, op) => this.apply(state, op), remote);
      this.base = remote; this.operations = operations; this.uncertain = null; this.conflict = false;
      this.message = operations.length ? "已加载最新数据，本机新增与排序已保留。请核对列表后点击重试保存。" : "";
    } catch (error) { this.message = (error as Error).message; this.conflict = true; }
    finally { this.paused = true; this.running = false; this.emit(); }
  }
  async discard() {
    if (this.running) return;
    this.running = true; this.emit();
    try { this.base = await this.transport(); this.operations = []; this.uncertain = null; this.message = ""; this.conflict = false; }
    catch (error) { this.message = (error as Error).message; }
    finally { this.running = false; this.emit(); }
  }
  exportOperations() { return this.operations; }
}
