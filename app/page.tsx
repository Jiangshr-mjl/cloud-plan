"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, Check, CheckCheck, ChevronDown, ChevronRight, Cloud, Download, Flag, FolderOpen, GripVertical, Grid2X2, History, KeyRound, ListTodo, LoaderCircle, LockKeyhole, LogOut, Plus, RefreshCw, Settings2, Sprout, Star, Sun, Trash2, Upload, X } from "lucide-react";
import { applyOperation, promoteUrgency, backupSchema, beijingDate, weekStart, isDailyTask, makeBackup, quadrant, sorted, type Operation, type Snapshot, type Task } from "@/lib/planner";

import { DailyQueue, type DailyOperation } from "@/lib/daily-queue";

import WorkTime from "./work-time";
import Habits from "./habits";
import CompletionChart from "./completion-chart";

const KEY_STORAGE = "daylight.access-key";
const GOAL_VIEW_STORAGE = "cloud-plan.goal-view";
const QUADRANTS = [
  { title: "重要且紧急", color: "coral", important: true, urgent: true },
  { title: "重要不紧急", color: "sage", important: true, urgent: false },
  { title: "不重要但紧急", color: "amber", important: false, urgent: true },
  { title: "不重要不紧急", color: "slate", important: false, urgent: false },
];
type View = "habits" | "daily" | "goals" | "history" | "settings";
type Draft = { id: string; kind: Task["kind"]; parentId: string | null; title: string; notes: string; plannedDate: string; dueDate: string; important: boolean; urgent: boolean; order: number; isNew: boolean };
type Pending = { operation: Operation; revision: number; after?: () => void };
class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
const dateLabel = (date: string) => new Date(`${date}T12:00:00+08:00`).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Shanghai" });
function shiftDate(value: string, amount: number) { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10); }
function download(tasks: Task[], prefix = "Cloud Plan备份") {
  const url = URL.createObjectURL(new Blob([JSON.stringify(makeBackup(tasks), null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `${prefix}-${beijingDate()}-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Planner() {
  const [accessKey, setAccessKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [view, setView] = useState<View>("daily");
  const [today, setToday] = useState(beijingDate());
  const [selectedDate, setSelectedDate] = useState(beijingDate());
  const [historyDate, setHistoryDate] = useState("");
  const [historyKind, setHistoryKind] = useState("all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropQuadrant, setDropQuadrant] = useState<number | null>(null);
  const drag = useRef<{ id: string; revision: number; x: number; y: number; moved: boolean } | null>(null);
  const [goalView, setGoalView] = useState<"quadrants" | "list">("quadrants");
  useEffect(() => { try { if (localStorage.getItem(GOAL_VIEW_STORAGE) === "list") setGoalView("list"); } catch {} }, []);
  function changeGoalView(value: "quadrants" | "list") { setGoalView(value); try { localStorage.setItem(GOAL_VIEW_STORAGE, value); } catch {} }
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const [rollDate, setRollDate] = useState(beijingDate());
  const [importData, setImportData] = useState<ReturnType<typeof backupSchema.parse> | null>(null);
  const [importError, setImportError] = useState("");
  const pending = useRef<Pending | null>(null);
  const quickQueue = useRef<DailyQueue | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tasks = snapshot?.tasks ?? [];

  useEffect(() => { try { setAccessKey(localStorage.getItem(KEY_STORAGE) ?? ""); } catch {} setReady(true); }, []);
  const api = useCallback(async (key: string, payload?: { revision: number; operation: Operation }): Promise<Snapshot> => {
    let response: Response;
    try { response = await fetch("/api/planner", { method: payload ? "POST" : "GET", headers: { "X-Planner-Key": key, ...(payload ? { "Content-Type": "application/json" } : {}) }, body: payload ? JSON.stringify(payload) : undefined, cache: "no-store", signal: AbortSignal.timeout(15000) }); }
    catch { throw new ApiError("网络连接中断，尚未确认保存。当前输入已保留，可联网后重试。", 0); }
    let body: Snapshot & { error?: string };
    try { body = await response.json() as Snapshot & { error?: string }; } catch { throw new ApiError("云端响应异常，请稍后重试", response.status); }
    if (!response.ok) throw new ApiError(body.error || "保存失败，请重试", response.status);
    return body;
  }, []);
  const refresh = useCallback(async (explicit = false) => {
    if (!accessKey || inFlight.current || quickQueue.current) return;
    const seq = ++generation.current;
    try {
      const data = await api(accessKey); if (seq !== generation.current) return;
      setSnapshot(data); setLastSync(new Date());
      if (explicit) { setError(""); setConflict(false); setDraftRevision(data.revision); if (pending.current) pending.current.revision = data.revision; setNotice("已加载最新计划。草稿已保留，请核对后重新保存。"); }
    } catch (e) {
      if (seq !== generation.current) return;
      const err = e as ApiError; setError(err.message);
      if (err.status === 401) { setAccessKey(""); setSnapshot(null); try { localStorage.removeItem(KEY_STORAGE); } catch {} }
    }
  }, [accessKey, api]);
  useEffect(() => { if (accessKey) void refresh(); }, [accessKey, refresh]);
  useEffect(() => {
    const tick = () => { setToday(beijingDate()); if (document.visibilityState === "visible" && !pending.current && !inFlight.current && !error) void refresh(); };
    const timer = setInterval(tick, 15000); document.addEventListener("visibilitychange", tick); window.addEventListener("focus", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); window.removeEventListener("focus", tick); };
  }, [refresh, error]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (draft || pending.current || quickQueue.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler);
  }, [draft]);
  useEffect(() => { if (draft && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal(); }, [draft]);
  async function unlock(e: FormEvent) {
    e.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); const key = keyInput.trim();
    try { const data = await api(key); try { localStorage.setItem(KEY_STORAGE, key); } catch { setNotice("浏览器禁止保存密钥，下次打开需要再次输入。"); } setAccessKey(key); setSnapshot(data); setKeyInput(""); setLastSync(new Date()); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); inFlight.current = false; }
  }
  function enqueueDaily(operation: DailyOperation) {
    if (pending.current || (inFlight.current && !quickQueue.current) || !snapshot || (quickQueue.current && error)) return false;
    ++generation.current; setNotice("");
    if (!quickQueue.current) quickQueue.current = new DailyQueue(snapshot, payload => api(accessKey, payload), state => {
      setSnapshot(state.snapshot); setQueueCount(state.count); setBusy(state.active); inFlight.current = state.active;
      setError(state.error); setConflict(state.conflict);
      if (!state.count && !state.active) { quickQueue.current = null; setLastSync(new Date()); setNotice("已同步到云端"); }
    });
    try { quickQueue.current.enqueue(operation); return true; }
    catch (e) { setError((e as Error).message); return false; }
  }
  function exportQueue() {
    if (!quickQueue.current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: "cloud-plan-pending-operations", operations: quickQueue.current.exportOperations() }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "Cloud-Plan-未保存操作.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function mutate(operation: Operation, after?: () => void, revision = snapshot?.revision ?? 0) {
    if (inFlight.current || quickQueue.current) return;
    inFlight.current = true; ++generation.current; setBusy(true); setError(""); setConflict(false); setNotice(""); pending.current = { operation, revision, after };
    const previous = snapshot;
    const optimistic = !!previous && (operation.type === "complete" || operation.type === "schedule" || operation.type === "reorder" || operation.type === "delete" || (operation.type === "edit" && !after));
    if (optimistic) {
      try { setSnapshot({ revision: previous.revision, tasks: promoteUrgency(applyOperation(previous.tasks, operation, revision + 1), revision + 1) }); } catch { /* The server returns the authoritative validation error. */ }
    }
    try { const data = await api(accessKey, { revision, operation }); setSnapshot(data); setLastSync(new Date()); pending.current = null; after?.(); setNotice(operation.type === "edit" && operation.changes.urgent === false && data.tasks.find(t => t.id === operation.id)?.urgent ? "已保存。截止日期已进入自动升级范围，任务归入紧急象限。" : "已保存到云端"); }
    catch (e) { if (optimistic) setSnapshot(previous); const err = e as ApiError; setError(err.message); setConflict(err.status === 409); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function newTask(kind: Task["kind"] = "daily", parentId: string | null = null, q = 1) {
    if (pending.current || (quickQueue.current && (kind !== "daily" || error)) || (inFlight.current && !quickQueue.current)) { setNotice("请先处理尚未保存的操作。"); return; }
    setDraftRevision(snapshot?.revision ?? 0);
    setDraft({ id: crypto.randomUUID(), kind, parentId, title: "", notes: "", plannedDate: kind === "weekly" ? weekStart(selectedDate) : kind === "daily" ? selectedDate : "", dueDate: "", important: QUADRANTS[q].important, urgent: QUADRANTS[q].urgent, order: Math.min(1000000, Math.max(0, ...tasks.map(t => t.order)) + 1), isNew: true });
  }
  function edit(task: Task) { if (pending.current || quickQueue.current) return; setDraftRevision(snapshot?.revision ?? 0); setDraft({ ...task, plannedDate: task.plannedDate ?? "", dueDate: task.dueDate ?? "", isNew: false }); }
  function closeDraft() { if ((busy && !(draft?.isNew && draft.kind === "daily" && quickQueue.current)) || !window.confirm("关闭编辑？尚未保存的输入将被舍弃。")) return; setDraft(null); if (!quickQueue.current) { pending.current = null; setError(""); setConflict(false); } }
  function saveDraft(e: FormEvent) {
    e.preventDefault(); if (!draft) return;
    const values = { title: draft.title.trim(), notes: draft.notes, plannedDate: draft.kind === "weekly" ? weekStart(draft.plannedDate) : draft.plannedDate || null, dueDate: draft.dueDate || null, important: draft.important, urgent: draft.urgent };
    const op: Operation = draft.isNew ? { type: "create", task: { ...values, id: draft.id, kind: draft.kind, parentId: draft.parentId, order: draft.order } } : { type: "edit", id: draft.id, changes: values };
    if (op.type === "create" && draft.kind === "daily") { if (enqueueDaily(op)) setDraft(null); return; }
    void mutate(op, () => setDraft(null), draftRevision);
  }
  function toggle(task: Task) {
    if (!task.completedAt && task.kind === "goal" && tasks.some(t => t.parentId === task.id && !t.completedAt) && !window.confirm("还有未完成子任务。仍完成这个长期任务吗？子任务将保持原状态。")) return;
    void mutate({ type: "complete", id: task.id, done: !task.completedAt, confirmIncomplete: true });
  }
  function remove(task: Task) {
    const count = tasks.filter(t => t.parentId === task.id).length;
    if (window.confirm(task.kind === "goal" ? `删除「${task.title}」？同时删除 ${count} 个子任务，包括每日清单中的关联记录。` : `删除「${task.title}」？此操作不可撤销。`)) void mutate({ type: "delete", id: task.id });
  }
  function reorder(list: Task[], index: number, offset: number) { const ids = list.map(t => t.id); [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]]; enqueueDaily({ type: "reorder", ids }); }
  async function exportBackup() {
    if (inFlight.current) return; inFlight.current = true; setBusy(true);
    try { const data = await api(accessKey); download(data.tasks); setNotice("备份已导出，请保管下载的 JSON 文件。"); } catch (e) { setError((e as Error).message); } finally { inFlight.current = false; setBusy(false); }
  }
  async function previewImport(file?: File) {
    setImportError(""); setImportData(null); if (!file) return;
    if (file.size > 4_000_000) { setImportError("文件超过 4 MB，请选择有效的Cloud Plan备份。"); return; }
    try { setImportData(backupSchema.parse(JSON.parse(await file.text()))); } catch { setImportError("文件格式、日期或子任务关联无效。现有数据未改变。"); }
  }
  async function restoreBackup() {
    if (!importData || inFlight.current || !window.confirm(`将用备份中的 ${importData.tasks.length} 条任务替换全部云端任务。先自动下载当前备份，然后继续？`)) return;
    inFlight.current = true; setBusy(true);
    try { const current = await api(accessKey); download(current.tasks, "导入前自动备份"); inFlight.current = false; await mutate({ type: "import", backup: importData }, () => setImportData(null), current.revision); }
    catch (e) { setError((e as Error).message); } finally { inFlight.current = false; setBusy(false); }
  }
  function forgetKey() {
    if (!window.confirm("忘记这台设备上的密钥？云端任务不受影响，下次需要重新输入密钥。")) return;
    if (quickQueue.current) return;
    ++generation.current; try { localStorage.removeItem(KEY_STORAGE); } catch {} setAccessKey(""); setSnapshot(null); setDraft(null); pending.current = null; setImportData(null); setError(""); setNotice(""); setView("daily");
  }
  const allDaily = sorted(tasks.filter(t => isDailyTask(t) && t.plannedDate === selectedDate));
  const daily = allDaily.filter(t => !t.completedAt);
  const overdue = sorted(tasks.filter(t => isDailyTask(t) && t.plannedDate && t.plannedDate < today && !t.completedAt));
  const goals = sorted(tasks.filter(t => t.kind === "goal" && !t.completedAt));
  const completed = tasks.filter(t => t.completedAt && (historyKind === "all" || t.kind === historyKind) && (!historyDate || beijingDate(new Date(t.completedAt)).startsWith(historyDate))).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
  const currentWeek = weekStart(selectedDate);
  const weekEnd = shiftDate(currentWeek, 6);
  const weekly = sorted(tasks.filter(t => t.kind === "weekly" && t.plannedDate === currentWeek));
  const weeklyOpen = weekly.filter(t => !t.completedAt);
  const weekDaily = tasks.filter(t => isDailyTask(t) && t.plannedDate && t.plannedDate >= currentWeek && t.plannedDate <= weekEnd);
  const dailyDone = allDaily.length - daily.length;
  const percent = allDaily.length ? Math.round(dailyDone / allDaily.length * 100) : 0;
  const disabled = busy || !!pending.current || queueCount > 0;
  const dailyBlocked = !!pending.current || (busy && !quickQueue.current) || (queueCount > 0 && !!error);
  const formBusy = draft?.isNew && draft.kind === "daily" ? dailyBlocked : busy;
  const queuedIds = new Set(quickQueue.current?.exportOperations().flatMap(op => op.type === "create" ? [op.task.id] : op.ids) ?? []);
  function due(task: Task) {
    if (!task.dueDate || task.completedAt) return null;
    const diff = Math.round((Date.parse(task.dueDate) - Date.parse(today)) / 86400000);
    return <span className={`due ${diff < 0 ? "late" : diff <= 3 ? "soon" : ""}`}><Flag size={11} />{diff < 0 ? `逾期 ${-diff} 天` : diff === 0 ? "今天截止" : `${task.dueDate.slice(5).replace("-", "/")} 截止`}</span>;
  }
  function row(task: Task, list?: Task[], index = 0, compact = false) {
    const parent = tasks.find(t => t.id === task.parentId);
    const focused = isDailyTask(task) && !!task.plannedDate && task.focusDate === task.plannedDate && !task.completedAt;
    return <div className={`task-row ${task.completedAt ? "is-done" : ""} ${compact ? "compact" : ""} ${focused ? "is-focus" : ""}`} key={task.id}>
      <button className={`check-button ${task.completedAt ? "checked" : ""}`} aria-label={`${task.completedAt ? "取消完成" : "完成"}：${task.title}`} onClick={() => toggle(task)} disabled={disabled}>{task.completedAt && <Check size={14} strokeWidth={3} />}</button>
      <button className="task-main" onClick={() => edit(task)} disabled={disabled} aria-label={`编辑：${task.title}`}><span className="task-title">{task.title}</span><span className="task-meta">{focused && <span className="focus-badge"><Star size={11} fill="currentColor" />{task.plannedDate === today ? "今日重点" : "当日重点"}</span>}{queuedIds.has(task.id) && <span className="pending-tag">{error ? "未保存" : "待同步"}</span>}{parent && <span><FolderOpen size={11} />{parent.title}</span>}{task.kind === "weekly" && <span>周重点 · {task.plannedDate}</span>}{compact && task.kind !== "weekly" && task.plannedDate && <span>{task.plannedDate}</span>}{due(task)}{task.notes && !compact && <span className="note-preview">{task.notes}</span>}</span></button>
      <div className="row-tools">{list && <button className={`focus-button ${focused ? "selected" : ""}`} aria-label={`${focused ? "取消重点" : "标记重点"}：${task.title}`} aria-pressed={focused} title={focused ? "取消重点" : "标记为当天重点任务"} disabled={disabled} onClick={() => void mutate({ type: "edit", id: task.id, changes: { focusDate: focused ? null : task.plannedDate } })}><Star size={17} fill={focused ? "currentColor" : "none"} /><span>重点</span></button>}{list && <div className="sort-buttons"><button className="icon-button" aria-label={`上移：${task.title}`} disabled={dailyBlocked || index === 0} onClick={() => reorder(list, index, -1)}><ArrowUp size={13} /></button><button className="icon-button" aria-label={`下移：${task.title}`} disabled={dailyBlocked || index === list.length - 1} onClick={() => reorder(list, index, 1)}><ArrowDown size={13} /></button></div>}{compact && isDailyTask(task) && !task.completedAt && task.plannedDate !== today && <button className="text-button" disabled={disabled} onClick={() => void mutate({ type: "schedule", ids: [task.id], date: today })}>移至今天</button>}<button className="icon-button delete" aria-label={`删除：${task.title}`} onClick={() => remove(task)} disabled={disabled}><Trash2 size={14} /></button></div>
    </div>;
  }
  function dropTarget(x: number, y: number) {
    const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-quadrant]");
    return zone ? Number(zone.dataset.quadrant) : null;
  }
  function beginDrag(e: ReactPointerEvent<HTMLButtonElement>, task: Task) {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: task.id, revision: snapshot?.revision ?? 0, x: e.clientX, y: e.clientY, moved: false };
  }
  function moveDrag(e: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current; if (!current) return;
    if (Math.hypot(e.clientX - current.x, e.clientY - current.y) < 6 && !current.moved) return;
    current.moved = true; setDraggingId(current.id); setDropQuadrant(dropTarget(e.clientX, e.clientY));
  }
  function cancelDrag() { drag.current = null; setDraggingId(null); setDropQuadrant(null); }
  function finishDrag(e: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current; const target = dropTarget(e.clientX, e.clientY); cancelDrag();
    if (!current?.moved || target === null) return;
    const task = tasks.find(t => t.id === current.id); if (!task || quadrant(task) === target) return;
    const q = QUADRANTS[target];
    void mutate({ type: "edit", id: task.id, changes: { important: q.important, urgent: q.urgent } }, undefined, current.revision);
  }
  function goalCard(goal: Task, list = false) { const i = quadrant(goal); const steps = sorted(tasks.filter(t => t.parentId === goal.id)); const count = steps.filter(t => t.completedAt).length; const progress = steps.length ? Math.round(count / steps.length * 100) : 0; const open = expanded.has(goal.id); return <article className={`goal-card ${list ? "list-goal-card" : ""} ${draggingId === goal.id ? "is-dragging" : ""}`} key={goal.id}><div className="goal-title-row">{!list && <button className="drag-handle" aria-label={`拖动：${goal.title}`} title="拖动到其他象限；也可通过编辑任务更改分类" disabled={disabled} onPointerDown={e => beginDrag(e, goal)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}><GripVertical size={17} /></button>}<button className="check-button" aria-label={`完成：${goal.title}`} onClick={() => toggle(goal)} disabled={disabled} /><button className="goal-title" onClick={() => setExpanded(prev => { const copy = new Set(prev); if (copy.has(goal.id)) copy.delete(goal.id); else copy.add(goal.id); return copy; })} aria-expanded={open}>{goal.title}{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></div><div className="goal-meta">{list && <span className={`goal-category ${QUADRANTS[i].color}`}>{QUADRANTS[i].title}</span>}{due(goal)}<span>{steps.length ? `${count} / ${steps.length} 步已完成` : "还没有子任务"}</span><strong className="goal-percent">{progress}%</strong></div><div className="thin-progress"><span style={{ width: `${progress}%` }} /></div>{open && <div className="goal-detail">{goal.notes && <p className="goal-notes">{goal.notes}</p>}{steps.filter(t => !t.completedAt).map(t => row(t, undefined, 0, true))}{steps.length > 0 && count === steps.length && <p className="goal-notes">子任务已全部完成，可在工作记录中查看或撤销。</p>}<button className="add-line" disabled={disabled} onClick={() => newTask("step", goal.id, i)}><Plus size={14} />添加子任务</button><div className="goal-actions"><button className="text-button" disabled={disabled} onClick={() => edit(goal)}>编辑任务</button><button className="text-button danger" disabled={disabled} onClick={() => remove(goal)}>删除</button></div></div>}</article>;
  }
  function errorBanner(inDialog = false) {
    if (queueCount > 0 && !busy && error) return <div className="error-banner" role="alert"><strong>尚未保存 · {queueCount} 项操作</strong><p>{error}</p><p>本机新增与排序已保留，请勿关闭页面。联网后可重试，或先导出未保存操作。</p><div className="banner-actions"><button type="button" onClick={() => void quickQueue.current?.reload()}>加载最新，保留待保存操作</button>{!conflict && <button type="button" onClick={() => void quickQueue.current?.retry()}>重试保存</button>}<button type="button" onClick={exportQueue}>导出未保存操作</button><button type="button" onClick={() => { if (window.confirm("取消尚未保存的新增和排序？已保存的云端任务不受影响。")) void quickQueue.current?.discard(); }}>取消待保存操作</button></div></div>;
    if (busy || (!error && !pending.current)) return null;
    return <div className="error-banner" role="alert"><strong>{pending.current ? "尚未保存" : "连接提示"}</strong><p>{error || "最新计划已加载，请核对后重新保存。"}</p><div className="banner-actions"><button type="button" onClick={() => void refresh(true)} disabled={busy}><RefreshCw size={13} />加载最新{inDialog ? "，保留草稿" : ""}</button>{pending.current && !conflict && <button type="button" disabled={busy} onClick={() => { const p = pending.current; if (p) void mutate(p.operation, p.after, p.revision); }}>重试保存</button>}{pending.current && !inDialog && <button type="button" disabled={busy} onClick={() => { pending.current = null; setError(""); setConflict(false); void refresh(true); }}>取消待保存操作</button>}</div></div>;
  }
  if (!ready || (accessKey && !snapshot && !error)) return <div className="loading-screen"><Sun size={36} /><p>正在打开你的计划…</p></div>;
  if (!snapshot) return <main className="welcome"><div className="welcome-brand"><span className="brand-icon"><Cloud size={23} /></span><span>Cloud Plan</span></div><section className="welcome-copy"><div className="cloud-illustration" aria-hidden="true"><Cloud strokeWidth={1} /><span className="floating-check"><Check size={22} /></span><span className="orbit-dot" /></div><h1>让计划清晰，<br /><em>让生活轻盈。</em></h1></section><form className="unlock-card" onSubmit={unlock}><span className="lock-symbol"><LockKeyhole size={26} /></span><h2>回到你的计划</h2><p>输入访问密钥，设备会自动记住。</p><label htmlFor="access-key">访问密钥</label><input id="access-key" type="password" autoComplete="off" autoFocus placeholder="输入你的 32 位访问密钥" value={keyInput} onChange={e => setKeyInput(e.target.value)} required minLength={32} maxLength={256} />{error && <p className="inline-error" role="alert">{error}</p>}<button className="primary wide" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}打开计划表</button>{accessKey && <button type="button" className="text-button" onClick={() => void refresh(true)}>重新连接已记住的密钥</button>}</form></main>;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); setView("daily"); }}><span className="brand-icon"><Cloud size={23} /></span><span>Cloud Plan</span></a><div className="space-label">我的计划空间</div><nav aria-label="主导航">{([{ id: "daily", text: "每日计划", icon: CalendarDays }, { id: "goals", text: "长期任务", icon: Grid2X2 }, { id: "habits", text: "21 天习惯", icon: Sprout }, { id: "history", text: "工作记录", icon: History }, { id: "settings", text: "设置与备份", icon: Settings2 }] as const).map(item => <button className={`nav-item ${view === item.id ? "active" : ""}`} key={item.id} onClick={() => setView(item.id)}><item.icon size={19} /><span>{item.text}</span>{item.id === "daily" && <small>{tasks.filter(t => isDailyTask(t) && t.plannedDate === today && !t.completedAt).length}</small>}</button>)}</nav><div className="sidebar-bottom"><div className="quiet-note"><Sprout size={24} /><p>不必一次完成所有事。<br />今天，向前一步就好。</p></div><div className="private-space"><span><LockKeyhole size={15} /></span><div>我的私人计划<small>密钥保护 · 多设备同步</small></div></div></div></aside>
    <main className="main-panel"><header className="topbar"><span><span className="breadcrumb">Cloud Plan</span><ChevronRight size={13} />{{ daily: "每日计划", goals: "长期任务", habits: "21 天习惯", history: "工作记录", settings: "设置与备份" }[view]}</span><button className={`sync-status ${error ? "sync-error" : ""}`} onClick={() => void refresh(true)} disabled={busy || queueCount > 0} title="刷新云端数据">{busy ? <LoaderCircle size={14} className="spin" /> : <Cloud size={14} />}<span>{busy ? "正在保存…" : error ? "连接异常" : "已同步"}</span><span className="status-dot" /></button></header>
      <div className="content">{queueCount > 0 && busy && <div className="notice" role="status">正在同步 {queueCount} 项操作，可继续新增每日任务或调整顺序。</div>}{errorBanner()}{notice && <div className="notice" role="status">{notice}<button className="icon-button" onClick={() => setNotice("")} aria-label="关闭提示"><X size={13} /></button></div>}
        <WorkTime accessKey={accessKey} visible={view === "history"} open={() => setView("history")} /><Habits tasks={tasks} revision={snapshot.revision} disabled={disabled} visible={view === "habits"} open={() => setView("habits")} save={mutate} remove={remove} />{view === "daily" && <><div className="page-heading"><div><h1>{selectedDate === today ? "今天，也从容一点。" : "为这一天，留好安排。"}</h1><p>{dateLabel(selectedDate)}</p></div><button className="primary" onClick={() => newTask()} disabled={dailyBlocked}><Plus size={18} />添加任务</button></div>
          <div className="day-overview" aria-label="计划概览"><div><strong>{daily.length}<small>项待完成</small></strong></div><div><strong>{goals.length}<small>个长期目标</small></strong></div><div><strong>{overdue.length}<small>项等待安排</small></strong></div><Cloud className="overview-cloud" aria-hidden="true" /></div><section className="week-plan" aria-label="周计划">
            <div className="week-heading"><div><h2>周计划</h2><p>{currentWeek} — {weekEnd} · {weeklyOpen.length} 项重点待完成</p></div><div className="week-actions"><button className="icon-button" aria-label="上一周" onClick={() => setSelectedDate(shiftDate(selectedDate, -7))}><ChevronRight className="flip" size={17} /></button><button className="today-button" onClick={() => setSelectedDate(today)}>本周</button><button className="icon-button" aria-label="下一周" onClick={() => setSelectedDate(shiftDate(selectedDate, 7))}><ChevronRight size={17} /></button></div></div>
            <div className="week-focus"><div className="week-focus-heading"><h3><Flag size={15} />这一周，聚焦什么？</h3><button className="text-button" onClick={() => newTask("weekly")} disabled={disabled}><Plus size={15} />添加本周重点</button></div>{weeklyOpen.length ? weeklyOpen.map(t => row(t)) : <p className="week-empty">{weekly.length ? "这一周的重点已全部完成。" : "暂无本周重点"}</p>}{weekly.length > 0 && <span className="week-completion">已完成 {weekly.length - weeklyOpen.length} / {weekly.length} 项重点</span>}</div>
            <div className="week-strip" aria-label="整周每日安排">{Array.from({ length: 7 }, (_, i) => { const date = shiftDate(currentWeek, i); const items = sorted(weekDaily.filter(t => t.plannedDate === date)); const unfinished = items.filter(t => !t.completedAt); return <button key={date} className={date === selectedDate ? "selected" : ""} aria-pressed={date === selectedDate} aria-label={`查看 ${date} 的每日计划`} onClick={() => setSelectedDate(date)}><span className="week-day">{["周一", "周二", "周三", "周四", "周五", "周六", "周日"][i]}{date === today && <b>今天</b>}</span><strong>{Number(date.slice(8))}</strong><span className="week-count">{items.length ? `${unfinished.length} 待办 / ${items.length} 项` : "留有空间"}</span><span className="week-preview">{unfinished[0]?.title ?? (items.length ? "全部完成 ✓" : "暂无安排")}</span></button>; })}</div>
          </section><div className="daily-layout"><section className="task-card"><div className="card-toolbar"><div className="date-nav"><button className="icon-button" aria-label="前一天" onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}><ChevronRight className="flip" size={17} /></button><label className="date-input"><CalendarDays size={15} /><input type="date" aria-label="计划日期" min="1900-01-01" max="2200-12-31" value={selectedDate} onChange={e => e.target.value && setSelectedDate(e.target.value)} /></label><button className="icon-button" aria-label="后一天" onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}><ChevronRight size={17} /></button><button className="today-button" onClick={() => setSelectedDate(today)}>今天</button></div><span className="count-label">{daily.length} 项待办</span></div><div className="list-heading"><h2>这一天的清单</h2><span>{dailyDone} / {allDaily.length} 已完成</span></div>
          {daily.length ? <div className="task-list">{daily.map((t, i) => row(t, daily, i))}</div> : <div className="empty-state"><span className="empty-icon"><ListTodo size={30} /></span><h3>{allDaily.length ? "这一天的待办已全部完成" : "留一点空间，给今天"}</h3>{allDaily.length > 0 && <button className="text-button" onClick={() => setView("history")}>查看工作记录 <ArrowRight size={14} /></button>}<button className="secondary" onClick={() => newTask()} disabled={disabled}><Plus size={16} />写下第一件事</button></div>}<button className="add-line" onClick={() => newTask()} disabled={disabled}><Plus size={16} />添加任务</button></section>
          <aside className="daily-aside"><section className="progress-card"><div className="mini-label"><Sun size={15} />{selectedDate === today ? "今日进度" : "当日进度"}</div><div className="progress-ring" style={{ background: `conic-gradient(var(--green) ${percent}%, #e7efff 0)` }}><div><strong>{percent}<small>%</small></strong><span>完成进度</span></div></div><p>已完成 {dailyDone} 项，还有 {daily.length} 项</p></section></aside></div>
          <details className="overdue-panel"><summary><span><History size={17} />往日未完成 <b>{overdue.length}</b></span><span className="summary-hint"><ChevronDown size={16} /></span></summary><div className="overdue-content">{overdue.length ? <><div className="roll-controls"><span>把这些事项安排到</span><input type="date" aria-label="批量顺延日期" min="1900-01-01" max="2200-12-31" value={rollDate} onChange={e => setRollDate(e.target.value)} /><button className="secondary small" disabled={disabled || !rollDate} onClick={() => void mutate({ type: "schedule", ids: overdue.map(t => t.id), date: rollDate })}>全部顺延</button><button className="text-button" disabled={disabled} onClick={() => void mutate({ type: "schedule", ids: overdue.map(t => t.id), date: today })}>全部移至今天</button></div>{overdue.map(t => row(t, undefined, 0, true))}</> : <p className="muted">暂无往日未完成任务</p>}</div></details></>}
        {view === "goals" && <><div className="page-heading"><div><h1>为重要的事，留出时间。</h1></div><button className="primary" onClick={() => newTask("goal")} disabled={disabled}><Plus size={18} />新建长期任务</button></div><div className="goal-view-toolbar"><div className="goal-view-switch" role="group" aria-label="长期任务视图"><button aria-pressed={goalView === "quadrants"} onClick={() => changeGoalView("quadrants")}><Grid2X2 size={16} />四象限</button><button aria-pressed={goalView === "list"} onClick={() => changeGoalView("list")}><ListTodo size={17} />列表</button></div><span>{goals.length} 个进行中的长期任务</span></div>{goalView === "list" ? <section className="goals-list-view" aria-label="长期任务列表">{goals.length ? goals.map(goal => goalCard(goal, true)) : <div className="empty-state"><span className="empty-icon"><ListTodo size={30} /></span><h3>从一个长期目标开始</h3><button className="secondary" onClick={() => newTask("goal")} disabled={disabled}><Plus size={16} />添加长期任务</button></div>}</section> : <><div className="priority-matrix"><div className="matrix-axis vertical" aria-hidden="true" /><div className="matrix-axis horizontal" aria-hidden="true" /><span className="axis-label axis-top">重要</span><span className="axis-label axis-bottom">不重要</span><span className="axis-label axis-left">紧急</span><span className="axis-label axis-right">不紧急</span><div className="quadrant-grid">{QUADRANTS.map((q, i) => <section key={q.color} data-quadrant={i} aria-label={q.title} className={`quadrant ${q.color} ${dropQuadrant === i ? "drop-target" : ""}`}><div className="quadrant-heading"><div><span className="quadrant-dot" /><h2>{q.title}</h2><span className="quadrant-count">{goals.filter(t => quadrant(t) === i).length}</span></div></div><div className="goal-list">{goals.filter(t => quadrant(t) === i).map(goal => goalCard(goal))}{!goals.some(t => quadrant(t) === i) && <div className="quadrant-empty"><Sprout size={24} /></div>}</div><button className="quadrant-add" disabled={disabled} onClick={() => newTask("goal", null, i)}><Plus size={15} />添加长期任务</button></section>)}</div></div></>}<details className="disclosure-note"><summary>分类说明</summary><p><Flag size={13} />拖动手柄可移动任务；重要任务剩余 ≤7 天、不重要任务剩余 ≤3 天自动转为紧急（含逾期）。无截止日期不自动移动。</p></details></>}
        {view === "history" && <><div className="page-heading"><div><h2 className="records-section-title">完成任务</h2></div><label className="history-filter">完成日期<input type="date" aria-label="完成日期筛选" value={historyDate.length === 10 ? historyDate : ""} onChange={e => setHistoryDate(e.target.value)} />{historyDate && <button className="text-button" onClick={() => setHistoryDate("")}>全部</button>}</label></div><CompletionChart tasks={tasks} today={today} selected={historyDate} onSelect={setHistoryDate} kind={historyKind} onKindChange={setHistoryKind} /><div className="history-selection" role="status"><span>{historyDate ? `${historyDate}${historyDate.length === 7 ? " 月" : ""}` : "全部时间"} · {({all:"全部类型",daily:"每日任务",step:"长期子任务",goal:"长期任务",weekly:"周重点"} as Record<string,string>)[historyKind]} · {completed.length} 项完成</span>{(historyDate || historyKind !== "all") && <button className="text-button" onClick={() => {setHistoryDate("");setHistoryKind("all");}}>清除筛选</button>}</div><section className="task-card history-card">{!completed.length ? <div className="empty-state"><span className="empty-icon"><CheckCheck size={30} /></span><h3>{historyDate || historyKind !== "all" ? "当前筛选下没有完成任务" : "这里会记下你的每一份努力"}</h3></div> : Object.entries(completed.reduce<Record<string, Task[]>>((groups, task) => { const date = beijingDate(new Date(task.completedAt!)); (groups[date] ??= []).push(task); return groups; }, {})).map(([date, items]) => <section key={date}><div className="history-day"><h2>{dateLabel(date)}</h2><span>{items.length} 项完成</span></div>{items.map(t => row(t, undefined, 0, true))}</section>)}</section></>}
        {view === "settings" && <><div className="page-heading"><div><h1>安心记录，妥善保管。</h1></div></div><div className="settings-grid"><section className="settings-card"><span className="settings-symbol"><Cloud size={23} /></span><h2>云端同步</h2><p>同一密钥可在多设备同步计划。</p><dl><div><dt>同步状态</dt><dd>{error ? "需要重试" : "已连接云端"}</dd></div><div><dt>最近同步</dt><dd>{lastSync?.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) ?? "—"}</dd></div><div><dt>日期时区</dt><dd>北京时间 UTC+8</dd></div><div><dt>任务数量</dt><dd>{tasks.length} 项</dd></div></dl><button className="secondary" disabled={busy} onClick={() => void refresh(true)}><RefreshCw size={15} />立即同步</button></section><section className="settings-card"><span className="settings-symbol"><Download size={23} /></span><h2>备份与恢复</h2><p>导出包含任务、子任务和任务完成记录的 JSON 文件。工作时长请在“工作记录”页面单独导出。导入会替换全部现有任务，并先下载当前备份。</p><div className="backup-buttons"><button className="secondary" disabled={disabled} onClick={() => void exportBackup()}><Download size={15} />导出备份</button><button className="secondary" disabled={disabled} onClick={() => fileInput.current?.click()}><Upload size={15} />选择备份文件</button><input hidden ref={fileInput} type="file" accept=".json,application/json" onChange={e => { void previewImport(e.target.files?.[0]); e.target.value = ""; }} /></div>{importError && <p className="inline-error" role="alert">{importError}</p>}{importData && <div className="import-preview"><h3>备份校验通过</h3><p>{importData.tasks.length} 条任务 · {importData.tasks.filter(t => t.kind === "goal").length} 个长期任务 · {importData.tasks.filter(t => t.completedAt).length} 条已完成</p><p>导出于 {new Date(importData.exportedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p><button className="primary small" disabled={disabled} onClick={() => void restoreBackup()}>备份当前数据并替换</button><button className="text-button" onClick={() => setImportData(null)} disabled={busy}>取消</button></div>}</section><section className="settings-card key-card"><span className="settings-symbol"><KeyRound size={23} /></span><div><h2>这台设备的访问密钥</h2><p>忘记本机密钥不会删除云端任务。</p></div><button className="secondary" disabled={busy || queueCount > 0} onClick={forgetKey}><LogOut size={15} />忘记本机密钥</button></section></div></>}

      </div>
    </main>
    {draft && <dialog ref={dialogRef} className="task-dialog" onCancel={e => { e.preventDefault(); closeDraft(); }}><form onSubmit={saveDraft}><div className="dialog-heading"><div><h2>{draft.isNew ? "添加" : "编辑"}{draft.kind === "goal" ? "长期任务" : draft.kind === "step" ? "子任务" : draft.kind === "weekly" ? "周重点" : "每日任务"}</h2></div><button type="button" className="icon-button" aria-label="关闭编辑" onClick={closeDraft} disabled={formBusy}><X size={20} /></button></div>{errorBanner(true)}<label>任务名称<input autoFocus required maxLength={160} placeholder="你想完成什么？" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>{draft.parentId && <div className="parent-label"><FolderOpen size={14} />{tasks.find(t => t.id === draft.parentId)?.title ?? "所属长期任务已被删除"}</div>}<label>备注 <span>选填</span><textarea rows={3} maxLength={10000} placeholder="记下想法，或下一步要做的事…" value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label><div className="form-columns">{draft.kind !== "goal" && <label>{draft.kind === "weekly" ? "所属周（任选一天）" : "计划日期"} <span>{draft.kind === "step" ? "可稍后安排" : ""}</span><input type="date" min="1900-01-01" max="2200-12-31" required={draft.kind === "daily" || draft.kind === "weekly"} value={draft.plannedDate} onChange={e => setDraft({ ...draft, plannedDate: e.target.value })} /></label>}<label>截止日期 <span>选填</span><input type="date" min="1900-01-01" max="2200-12-31" value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} /></label></div>{draft.kind === "goal" && <p className="deadline-rule">截止日期可留空。重要任务剩余 7 天、不重要任务剩余 3 天起自动归入紧急象限；之后不会自动降级。</p>}{draft.kind === "goal" && <fieldset className="quadrant-picker"><legend>重要紧急分类</legend>{QUADRANTS.map(q => <label key={q.color} className={draft.important === q.important && draft.urgent === q.urgent ? "picked" : ""}><input type="radio" name="quadrant" checked={draft.important === q.important && draft.urgent === q.urgent} onChange={() => setDraft({ ...draft, important: q.important, urgent: q.urgent })} />{q.title}</label>)}</fieldset>}<div className="dialog-footer"><button className="primary" type="submit" disabled={formBusy || conflict || !draft.title.trim()}>{formBusy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存任务</button></div></form></dialog>}
  </div>;
}
