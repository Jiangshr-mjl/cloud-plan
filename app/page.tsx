"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, Check, CheckCheck, ChevronDown, ChevronRight, Cloud, Download, Flag, Folder, FolderOpen, GripVertical, Grid2X2, History, KeyRound, ListTodo, MoreHorizontal, LoaderCircle, LockKeyhole, LogOut, Plus, RefreshCw, Search, Settings, Sprout, Star, Sun, Trash2, Upload, X } from "lucide-react";
import { descendantIds, backupSchema, beijingDate, weekStart, isDailyTask, makeBackup, quadrant, sorted, type Operation, type Snapshot, type Task } from "@/lib/planner";

import { DailyQueue, type DailyOperation } from "@/lib/daily-queue";

import WorkTime from "./work-time";
import Habits from "./habits";
import CompletionChart from "./completion-chart";
import SpatialTaskBoard from "./spatial-task-board";
import QuickSubtask from "./quick-subtask";

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
const shortDate = (date: string) => `${Number(date.slice(5,7))}月${Number(date.slice(8))}日`;
const dateLabel = (date: string) => new Date(`${date}T12:00:00+08:00`).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Shanghai" });
function shiftDate(value: string, amount: number) { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10); }
function download(tasks: Task[], prefix = "Cloud Plan备份") {
  const url = URL.createObjectURL(new Blob([JSON.stringify(makeBackup(tasks), null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `${prefix}-${beijingDate()}-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function taskDriftStyle(id: string): CSSProperties {
  let seed = 2166136261;
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const random = () => {seed ^= seed << 13;seed ^= seed >>> 17;seed ^= seed << 5;return (seed >>> 0) / 4294967296;};
  const style: Record<string,string> = {"--drift-duration": `${16 + random()*10}s`, "--drift-delay": `${-random()*26}s`};
  for (let i=0;i<5;i++) {
    style[`--drift-x${i}`] = `${(random()*28-14).toFixed(2)}px`;
    style[`--drift-y${i}`] = `${(random()*24-12).toFixed(2)}px`;
    style[`--drift-r${i}`] = `${(random()*2.6-1.3).toFixed(2)}deg`;
  }
  return style as CSSProperties;
}

export default function Planner() {
  const [accessKey, setAccessKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [habitReminders, setHabitReminders] = useState(0);
  const [notice, setNotice] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [view, setView] = useState<View>("daily");
  const [today, setToday] = useState(beijingDate());
  const [selectedDate, setSelectedDate] = useState(beijingDate());
  const [historyDate, setHistoryDate] = useState("");
  const [historyKind, setHistoryKind] = useState("all");
  const [historyView, setHistoryView] = useState<"time" | "project">("time");
  const [historySearch, setHistorySearch] = useState("");
  const historyQuery = historySearch.trim().toLocaleLowerCase();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [scheduleTask, setScheduleTask] = useState<string | null>(null);
  const [dropDate, setDropDate] = useState<string | null>(null);
  const [dropProject, setDropProject] = useState<string | null>(null);
  const [matrixDetails, setMatrixDetails] = useState<string | null>(null);
  const matrixPress = useRef<{timer: ReturnType<typeof setTimeout> | null; x:number; y:number; lastY:number; active:boolean; cancelled:boolean} | null>(null);
  const suppressMatrixClick = useRef(false);
  useEffect(() => () => {if(matrixPress.current?.timer)clearTimeout(matrixPress.current.timer);}, []);
  const [matrixTask, setMatrixTask] = useState<string | null>(null);
  const [dragPoint, setDragPoint] = useState<{x:number;y:number} | null>(null);
  const [dropQuadrant, setDropQuadrant] = useState<number | null>(null);
  const drag = useRef<{ id: string; revision: number; x: number; y: number; moved: boolean } | null>(null);
  const [quadrantFilter, setQuadrantFilter] = useState<number | null>(null);
  const [goalView, setGoalView] = useState<"quadrants" | "list" | "timeline">("list");
  useEffect(() => { try { const saved = localStorage.getItem(GOAL_VIEW_STORAGE); if (saved === "list" || saved === "quadrants" || saved === "timeline") setGoalView(saved); } catch {} }, []);
  function changeGoalView(value: "quadrants" | "list" | "timeline") { setGoalView(value); try { localStorage.setItem(GOAL_VIEW_STORAGE, value); } catch {} }
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
  useEffect(() => () => quickQueue.current?.dispose(), []);
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
    if (operation.type === "import" && quickQueue.current) { setNotice("请先同步待保存的变更，再恢复备份。"); return; }
    if (revision !== snapshot?.revision && !quickQueue.current) { setError("计划已更新，请重新打开编辑后保存。"); return; }
    if (enqueueDaily(operation)) after?.();
  }

  function newTask(kind: Task["kind"] = "daily", parentId: string | null = null, q = 1) {
    if (pending.current || (quickQueue.current && error) || (inFlight.current && !quickQueue.current)) { setNotice("请先处理尚未保存的操作。"); return; }
    setDraftRevision(snapshot?.revision ?? 0);
    setDraft({ id: crypto.randomUUID(), kind, parentId, title: "", notes: "", plannedDate: kind === "weekly" ? weekStart(selectedDate) : kind === "daily" ? selectedDate : "", dueDate: kind === "step" ? tasks.find(t => t.id === parentId && t.kind === "goal")?.dueDate ?? "" : "", important: QUADRANTS[q].important, urgent: QUADRANTS[q].urgent, order: Math.min(1000000, Math.max(0, ...tasks.map(t => t.order)) + 1), isNew: true });
  }
  function edit(task: Task) { if (pending.current || (quickQueue.current && error)) return; setDraftRevision(snapshot?.revision ?? 0); setDraft({ ...task, plannedDate: task.plannedDate ?? "", dueDate: task.dueDate ?? "", isNew: false }); }
  function closeDraft() { if ((busy && !quickQueue.current) || !window.confirm("关闭编辑？尚未保存的输入将被舍弃。")) return; setDraft(null); if (!quickQueue.current) { pending.current = null; setError(""); setConflict(false); } }
  function saveDraft(e: FormEvent) {
    e.preventDefault(); if (!draft) return;
    const values = { title: draft.title.trim(), notes: draft.notes, plannedDate: draft.kind === "weekly" ? weekStart(draft.plannedDate) : draft.plannedDate || null, dueDate: draft.dueDate || null, important: draft.important, urgent: draft.urgent };
    const op: Operation = draft.isNew ? { type: "create", task: { ...values, id: draft.id, kind: draft.kind, parentId: draft.parentId, order: draft.order } } : { type: "edit", id: draft.id, changes: values };
    if (op.type === "create" && draft.kind === "daily") { if (enqueueDaily(op)) setDraft(null); return; }
    void mutate(op, () => setDraft(null), draftRevision);
  }
  function toggle(task: Task) {
    if (!task.completedAt && (task.kind === "goal" || task.kind === "weekly") && tasks.some(t => descendantIds(tasks, task.id).has(t.id) && !t.completedAt) && !window.confirm(`还有未完成子任务。仍完成这个${task.kind === "weekly" ? "周目标" : "项目"}吗？子任务将保持原状态。`)) return;
    void mutate({ type: "complete", id: task.id, done: !task.completedAt, confirmIncomplete: true });
  }
  function remove(task: Task) {
    const count = descendantIds(tasks, task.id).size;
    if (window.confirm(task.kind === "goal" || task.kind === "weekly" ? `删除「${task.title}」？同时删除 ${count} 个子任务，包括每日清单中的关联记录。` : `删除「${task.title}」？此操作不可撤销。`)) void mutate({ type: "delete", id: task.id });
  }
  function reorder(list: Task[], index: number, offset: number) { const ids = list.map(t => t.id); [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]]; enqueueDaily({ type: "reorder", ids }); }
  async function exportBackup() {
    if (quickQueue.current && snapshot) { download(snapshot.tasks); setNotice("已导出当前计划（包含待同步变更）。"); return; }
    if (inFlight.current) return; inFlight.current = true; setBusy(true);
    try { const data = await api(accessKey); download(data.tasks); setNotice("备份已导出，请保管下载的 JSON 文件。"); } catch (e) { setError((e as Error).message); } finally { inFlight.current = false; setBusy(false); }
  }
  async function previewImport(file?: File) {
    setImportError(""); setImportData(null); if (!file) return;
    if (file.size > 4_000_000) { setImportError("文件超过 4 MB，请选择有效的Cloud Plan备份。"); return; }
    try { setImportData(backupSchema.parse(JSON.parse(await file.text()))); } catch { setImportError("文件格式、日期或子任务关联无效。现有数据未改变。"); }
  }
  async function restoreBackup() {
    if (!importData || quickQueue.current || inFlight.current || !window.confirm(`将用备份中的 ${importData.tasks.length} 条任务替换全部云端任务。先自动下载当前备份，然后继续？`)) return;
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
  const completed = tasks.filter(t => t.completedAt && (!historyQuery || t.title.toLocaleLowerCase().includes(historyQuery)) && (historyKind === "all" || t.kind === historyKind) && (!historyDate || beijingDate(new Date(t.completedAt)).startsWith(historyDate))).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
  const currentWeek = weekStart(selectedDate);
  const weekEnd = shiftDate(currentWeek, 6);
  const weekly = sorted(tasks.filter(t => (t.kind === "weekly" && t.plannedDate === currentWeek) || (t.kind === "goal" && t.weekDate === currentWeek)));
  const weeklyOpen = weekly.filter(t => !t.completedAt);
  const weekDaily = tasks.filter(t => isDailyTask(t) && t.plannedDate && t.plannedDate >= currentWeek && t.plannedDate <= weekEnd);
  const dailyDone = allDaily.length - daily.length;
  const percent = allDaily.length ? Math.round(dailyDone / allDaily.length * 100) : 0;
  const disabled = (busy && !quickQueue.current) || !!pending.current || (queueCount > 0 && !!error);
  const dailyBlocked = !!pending.current || (busy && !quickQueue.current) || (queueCount > 0 && !!error);
  const formBusy = dailyBlocked;
  const queuedIds = new Set(quickQueue.current?.exportOperations().flatMap(op => op.type === "create" ? [op.task.id] : "ids" in op ? op.ids : "id" in op ? [op.id] : []) ?? []);
  function due(task: Task) {
    if (!task.dueDate || task.completedAt) return null;
    const diff = Math.round((Date.parse(task.dueDate) - Date.parse(today)) / 86400000);
    return <span className={`due ${diff < 0 ? "late" : diff <= 3 ? "soon" : ""}`}><CalendarDays size={17} />{view === "goals" && goalView === "list" ? task.dueDate.slice(5).replace("-","/") : diff < 0 ? `逾期 ${-diff} 天` : diff === 0 ? "今天截止" : `${task.dueDate.slice(5).replace("-", "/")} 截止`}</span>;
  }
  useEffect(() => {
    const dismiss = (event: PointerEvent) => document.querySelectorAll<HTMLDetailsElement>(".task-options[open]").forEach(menu => { if (!menu.contains(event.target as Node)) menu.open = false; });
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") document.querySelectorAll<HTMLDetailsElement>(".task-options[open]").forEach(menu => { menu.open = false; menu.querySelector<HTMLElement>("summary")?.focus(); }); };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, []);
  function row(task: Task, list?: Task[], index = 0, compact = false, scheduleAction = false, dragSchedule = false, hideParent = false) {
    const parent = tasks.find(t => t.id === task.parentId);
    const focused = isDailyTask(task) && !!task.plannedDate && task.focusDate === task.plannedDate && !task.completedAt;
    return <div className={`task-row ${task.completedAt ? "is-done" : ""} ${compact ? "compact" : ""} ${focused ? "is-focus" : ""}`} key={task.id}>
      <button className={`check-button ${task.kind === "weekly" ? "weekly-check" : ""} ${task.completedAt ? "checked" : ""}`} aria-label={`${task.completedAt ? "取消完成" : "完成"}：${task.title}`} onClick={() => toggle(task)} disabled={disabled}>{task.completedAt ? <Check size={14} strokeWidth={3} /> : task.kind === "weekly" ? <Flag size={22}/> : null}</button>
      <button className="task-main" onClick={() => edit(task)} disabled={disabled} aria-label={`编辑：${task.title}`}><span className="task-title">{task.title}</span>{view === "goals" && goalView === "list" && scheduleAction && task.kind === "step" && !task.completedAt && task.plannedDate === selectedDate && <span className="project-scheduled-badge"><CalendarDays size={16} aria-hidden="true"/>已加入每日计划</span>}{task.kind === "step" && <span className={`subtask-priority goal-category ${QUADRANTS[quadrant(task)].color}`} title="点击任务可修改重要紧急分类">{QUADRANTS[quadrant(task)].title}</span>}<span className="task-meta">{focused && <span className="focus-badge"><Star size={11} fill="currentColor" />{task.plannedDate === today ? "今日重点" : "当日重点"}</span>}{queuedIds.has(task.id) && <span className="pending-tag">{error ? "未保存" : "待同步"}</span>}{parent && !hideParent && <span><FolderOpen size={11} />{parent.title}</span>}{task.kind === "weekly" && <span>周重点 · {task.plannedDate}</span>}{compact && task.kind !== "weekly" && task.plannedDate && <span>{task.plannedDate}</span>}{view !== "goals" && view !== "daily" && due(task)}{task.notes && !compact && <span className="note-preview">{task.notes}</span>}</span></button>
      {view === "goals" && goalView === "list" && <span className="row-progress" aria-hidden="true">—</span>}{(view === "goals" || view === "daily") && <span className="row-deadline">{due(task) ?? (view === "goals" ? "—" : null)}</span>}{list && <button className={`task-focus-toggle ${focused ? "selected" : ""}`} aria-label={`${focused ? "取消重点" : "标记重点"}：${task.title}`} aria-pressed={focused} title={focused ? "取消重点" : "标记当天重点"} disabled={disabled} onClick={() => void mutate({ type:"edit",id:task.id,changes:{focusDate:focused ? null : task.plannedDate} })}><Star size={22} fill={focused ? "currentColor" : "none"}/></button>}{scheduleAction && !dragSchedule && task.kind === "step" && !task.completedAt && <button className="text-button schedule-step" disabled={disabled || task.plannedDate === selectedDate} aria-label={`${task.plannedDate === selectedDate ? "已加入" : "加入"} ${selectedDate} 每日计划：${task.title}`} title={`安排到 ${selectedDate}；保留原任务关联`} onClick={() => void mutate({ type: "schedule", ids: [task.id], date: selectedDate })}><CalendarDays size={14} />{task.plannedDate === selectedDate ? "已加入每日计划" : "加入每日计划"}</button>}<details className="task-options"><summary aria-label={`任务操作：${task.title}`}><MoreHorizontal size={20}/></summary><div className="row-tools">{dragSchedule && !task.completedAt && <button className="drag-handle schedule-drag-handle" disabled={disabled} aria-label={`拖动安排日期：${task.title}`} title="拖到下方任意日期；键盘按 Enter 选择日期" onPointerDown={e => {beginDrag(e,task);if(!disabled && e.button === 0) setScheduleTask(task.id);}} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onKeyDown={e => {if(e.key === "Enter" || e.key === " "){e.preventDefault();setScheduleTask(task.id);}if(e.key === "Escape")cancelDrag();}}><GripVertical size={17}/><span>拖动安排</span></button>}{task.kind === "step" && parent?.kind === "goal" && task.plannedDate && !task.completedAt && <button className="text-button unschedule-step" disabled={disabled} aria-label={`撤回每日计划：${task.title}`} title={`撤回 ${task.plannedDate} 的安排，保留项目子任务`} onClick={() => void mutate({type:"edit",id:task.id,changes:{plannedDate:null,focusDate:null}})}><CalendarDays size={14} />撤回每日计划</button>}{list && <div className="sort-buttons"><button className="icon-button" aria-label={`上移：${task.title}`} disabled={dailyBlocked || index === 0} onClick={() => reorder(list, index, -1)}><ArrowUp size={13} /></button><button className="icon-button" aria-label={`下移：${task.title}`} disabled={dailyBlocked || index === list.length - 1} onClick={() => reorder(list, index, 1)}><ArrowDown size={13} /></button></div>}{compact && !scheduleAction && isDailyTask(task) && !task.completedAt && task.plannedDate !== today && <button className="text-button" disabled={disabled} onClick={() => void mutate({ type: "schedule", ids: [task.id], date: today })}>移至今天</button>}<button className="icon-button delete" aria-label={`删除：${task.title}`} onClick={() => remove(task)} disabled={disabled}><Trash2 size={14} /></button></div></details>
    </div>;
  }
  function dropTarget(x: number, y: number) {
    const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-quadrant]");
    return zone ? Number(zone.dataset.quadrant) : null;
  }
  function startMatrixPress(e: ReactPointerEvent<HTMLButtonElement>, task: Task) {
    if (disabled || e.button !== 0) return;
    cancelDrag();suppressMatrixClick.current = false;
    const button=e.currentTarget, pointerId=e.pointerId, x=e.clientX,y=e.clientY;
    button.setPointerCapture(pointerId);
    const press={timer:null as ReturnType<typeof setTimeout> | null,x,y,lastY:y,active:false,cancelled:false};
    matrixPress.current=press;
    if(e.pointerType === "mouse") {
      press.active=true;
      drag.current={id:task.id,revision:snapshot?.revision ?? 0,x,y,moved:false};
      setMatrixTask(task.id);
      return;
    }
    press.timer=setTimeout(()=>{
      if(matrixPress.current !== press || press.cancelled)return;
      press.active=true;suppressMatrixClick.current=true;
      drag.current={id:task.id,revision:snapshot?.revision ?? 0,x,y,moved:false};
      setMatrixTask(task.id);setDraggingId(task.id);setDragPoint({x,y});
    },180);
  }
  function moveMatrixPress(e: ReactPointerEvent<HTMLButtonElement>) {
    const press=matrixPress.current;if(!press)return;
    if(press.active){moveDrag(e);return;}
    if(Math.hypot(e.clientX-press.x,e.clientY-press.y)>8) {
      if(press.timer)clearTimeout(press.timer);
      press.cancelled=true;suppressMatrixClick.current=true;
    }
    if(press.cancelled && e.pointerType === "touch")window.scrollBy(0,press.lastY-e.clientY);
    press.lastY=e.clientY;
  }
  function endMatrixPress(e: ReactPointerEvent<HTMLButtonElement>) {
    const press=matrixPress.current;
    if(press?.timer)clearTimeout(press.timer);
    if(press?.active){suppressMatrixClick.current=suppressMatrixClick.current || !!drag.current?.moved;finishDrag(e);}
    matrixPress.current=null;
  }
  function beginDrag(e: ReactPointerEvent<HTMLButtonElement>, task: Task) {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: task.id, revision: snapshot?.revision ?? 0, x: e.clientX, y: e.clientY, moved: false };
  }
  function projectDropTarget(x: number, y: number, id: string) {
    const target = document.elementFromPoint(x,y)?.closest<HTMLElement>("[data-project-id]")?.dataset.projectId;
    const parent = tasks.find(t => t.id === target);
    return parent && !parent.completedAt && parent.id !== id && !descendantIds(tasks,id).has(parent.id) ? parent.id : null;
  }
  function dateDropTarget(x:number,y:number) { return document.elementFromPoint(x,y)?.closest<HTMLElement>("[data-plan-date]")?.dataset.planDate ?? null; }
  function moveDrag(e: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current; if (!current) return;
    if (Math.hypot(e.clientX - current.x, e.clientY - current.y) < 6 && !current.moved) return;
    current.moved = true; setDraggingId(current.id);
    if (matrixTask) {suppressMatrixClick.current=true;setDragPoint({x:e.clientX,y:e.clientY});}
    if (scheduleTask) {setDropDate(dateDropTarget(e.clientX,e.clientY));return;}
    if (tasks.find(t => t.id === current.id)?.kind === "goal") {
      setDropProject(projectDropTarget(e.clientX,e.clientY,current.id));
      if (e.clientY > window.innerHeight - 80) window.scrollBy(0,18); else if(e.clientY < 80) window.scrollBy(0,-18);
    } else setDropQuadrant(dropTarget(e.clientX, e.clientY));
  }
  function cancelDrag() { if(matrixPress.current?.timer)clearTimeout(matrixPress.current.timer);matrixPress.current=null;setMatrixTask(null);setDragPoint(null);drag.current = null; setDraggingId(null); setDropQuadrant(null); setDropProject(null); setScheduleTask(null);setDropDate(null); }
  function finishDrag(e: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (scheduleTask && current) {
      const date = dateDropTarget(e.clientX,e.clientY);cancelDrag();
      if(current.moved && date) void mutate({type:"schedule",ids:[current.id],date},undefined,current.revision);
      return;
    }
    if (current && tasks.find(t => t.id === current.id)?.kind === "goal") {
      const parentId = projectDropTarget(e.clientX,e.clientY,current.id); cancelDrag();
      if (current.moved && parentId && tasks.find(t => t.id === current.id)?.parentId !== parentId) void mutate({type:"moveProject",id:current.id,parentId},undefined,current.revision);
      return;
    }
    const target = dropTarget(e.clientX, e.clientY); cancelDrag();
    if (!current?.moved || target === null) return;
    const task = tasks.find(t => t.id === current.id); if (!task || quadrant(task) === target) return;
    const q = QUADRANTS[target];
    void mutate({ type: "edit", id: task.id, changes: { important: q.important, urgent: q.urgent } }, undefined, current.revision);
  }
  function quickSubtask(parent: Task, hidden = false) {
    return <QuickSubtask hidden={hidden} parentTitle={parent.title} disabled={disabled || !!parent.completedAt} onAdd={(title,accepted)=>void mutate({type:"create",task:{id:crypto.randomUUID(),kind:"step",parentId:parent.id,title,notes:"",plannedDate:null,dueDate:parent.kind === "goal" ? parent.dueDate : null,important:true,urgent:false,order:Math.min(1000000,Math.max(0,...tasks.map(t=>t.order))+1)}},()=>{setExpanded(prev=>new Set(prev).add(parent.id));accepted();})}/>;
  }
  function weeklyCard(goal: Task) {
    const steps = sorted(tasks.filter(t => t.parentId === goal.id));
    const count = steps.filter(t => t.completedAt).length;
    const open = expanded.has(goal.id);
    return <article className="weekly-goal" key={goal.id}>
      {row(goal)}
      <div className="weekly-subtask-heading">
        <button className="text-button" aria-expanded={open} aria-label={`展开子任务：${goal.title}`} onClick={() => setExpanded(prev => { const next = new Set(prev); if (next.has(goal.id)) next.delete(goal.id); else next.add(goal.id); return next; })}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{steps.length ? `${count} / ${steps.length} 子任务完成` : "子任务"}</button>

      </div>
      {quickSubtask(goal, !open)}
      {open && <div className="weekly-subtasks">{steps.map(t => row(t, undefined, 0, true, true, true, true))}{!steps.length && <p className="week-empty">暂无子任务</p>}</div>}
    </article>;
  }
  function projectCard(project: Task, timelineChildren?: Set<string>) {
    const ids = descendantIds(tasks, project.id);
    const steps = tasks.filter(t => ids.has(t.id) && t.kind === "step");
    const completedSteps = steps.filter(t => t.completedAt).length;
    const completionPercent = steps.length ? Math.round(completedSteps / steps.length * 100) : project.completedAt ? 100 : 0;
    const children = sorted(tasks.filter(t => t.parentId === project.id && (!timelineChildren || timelineChildren.has(t.id))));
    const doneSteps = children.filter(t => t.kind === "step" && t.completedAt);
    return <details data-project-id={project.id} className={`project-card ${dropProject === project.id ? "project-drop-target" : ""} ${draggingId === project.id ? "project-dragging" : ""}`} key={project.id}><summary><ChevronRight className="project-chevron" size={16}/>{view === "daily" ? <Flag size={22}/> : <Folder size={25}/>}<strong>{project.title}{project.weekDate === currentWeek && view !== "daily" && <span className="weekly-project-badge"><Flag size={13}/>已加入周重点</span>}</strong>{!project.completedAt && <button className="drag-handle project-drag-handle" aria-label={`移动项目：${project.title}`} title="拖入其他项目成为子项目；也可在项目设置中选择所属项目" disabled={disabled} onClick={e => {e.preventDefault();e.stopPropagation();}} onPointerDown={e => {e.stopPropagation();beginDrag(e,project);}} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onKeyDown={e => {if(e.key === "Escape") cancelDrag();}}><GripVertical size={18}/></button>}<span className="project-completion" title="按项目及所有子项目中的子任务计算完成比例"><b className="project-completion-percent">{completionPercent}%</b><span className="project-progress"><i style={{width:`${completionPercent}%`}}/></span><span>{completedSteps} / {steps.length}<span className="completion-unit"> 子任务{project.completedAt ? " · 已完成" : ""}</span></span></span><span className="project-deadline">{due(project)}</span></summary><div className="project-content"><div className="project-actions">
      <details className="project-settings"><summary aria-label={`项目设置：${project.title}`} title="项目设置"><MoreHorizontal size={20}/></summary><div className="project-settings-actions">      <button disabled={disabled} onClick={() => newTask("goal",project.id)}>添加子项目</button><button disabled={disabled} onClick={() => newTask("step",project.id)}>添加子任务</button>
      <button disabled={disabled || !!project.completedAt || project.weekDate === currentWeek} onClick={() => void mutate({type:"edit",id:project.id,changes:{weekDate:currentWeek}})}>{project.weekDate === currentWeek ? "已加入周目标" : "加入周目标"}</button>
{project.notes && <p className="project-notes">{project.notes}</p>}{!project.completedAt && <label className="project-parent-picker">所属项目<select aria-label={`所属项目：${project.title}`} disabled={disabled} value={project.parentId ?? ""} onChange={e => void mutate({type:"moveProject",id:project.id,parentId:e.target.value || null})}><option value="">顶层项目</option>{tasks.filter(t => t.kind === "goal" && !t.completedAt && t.id !== project.id && !ids.has(t.id)).map(t => <option value={t.id} key={t.id}>{t.title}</option>)}</select></label>}{project.weekDate && <button disabled={disabled} onClick={() => void mutate({type:"edit",id:project.id,changes:{weekDate:null}})}>移出周目标（{project.weekDate}）</button>}
      <button disabled={disabled} onClick={() => edit(project)}>编辑项目</button><button disabled={disabled} onClick={() => toggle(project)}>{project.completedAt ? "重新打开项目" : "完成项目"}</button><button disabled={disabled} className="danger" onClick={() => remove(project)}>删除项目</button></div></details>
    </div>{view === "daily" && quickSubtask(project)}{children.filter(t => !t.completedAt || (view === "history" && t.kind === "goal")).map(t => t.kind === "goal" ? projectCard(t, timelineChildren) : row(t,undefined,0,true,true,view === "daily",view === "daily"))}
      {view === "goals" && goalView === "list" && <button className="add-line project-add-step" aria-label={`添加子任务：${project.title}`} disabled={disabled} onClick={() => newTask("step",project.id)}><Plus size={20}/>添加子任务</button>}{doneSteps.length > 0 && <details className="completed-subtasks"><summary><ChevronRight size={15}/>{view === "goals" && goalView === "list" && <span className="completed-group-check" aria-hidden="true"><Check size={16} strokeWidth={3}/></span>}<span>已完成子任务</span><span className="completed-count">{doneSteps.length}</span></summary>{doneSteps.map(t => row(t,undefined,0,true,false,false,view === "daily"))}</details>}</div></details>;
  }

  function completedByProject() {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const groups = new Map<string, { title: string; items: {task: Task; path: string}[] }>();
    for (const task of completed) {
      const ancestry: Task[] = [];
      const visited = new Set<string>();
      let parent = task.kind === "goal" ? task : task.parentId ? byId.get(task.parentId) : undefined;
      while (parent && !visited.has(parent.id)) {
        visited.add(parent.id);
        if (parent.kind === "goal") ancestry.unshift(parent);
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      const root = ancestry[0];
      const key = root?.id ?? "unassigned";
      const group = groups.get(key) ?? {title: root?.title ?? "未关联项目", items: []};
      group.items.push({task, path: ancestry.slice(1).map(t => t.title).join(" / ")});
      groups.set(key, group);
    }
    return [...groups].sort(([a], [b]) => a === "unassigned" ? 1 : b === "unassigned" ? -1 : 0).map(([id, group]) => <details className="history-group history-project-group" key={id} data-history-project={id}><summary className="history-day"><ChevronRight className="history-chevron" size={18} aria-hidden="true" /><h2><FolderOpen size={16} aria-hidden="true" />{group.title}</h2><span>{group.items.length} 项完成</span></summary>{group.items.map(({task,path}) => <div key={task.id}><div className="history-project-meta">{path && <span>{path}</span>}<time dateTime={task.completedAt!}>{dateLabel(beijingDate(new Date(task.completedAt!)))}完成</time></div>{row(task,undefined,0,true)}</div>)}</details>);
  }

  function projectTimeline() {
    const projects = new Set(tasks.filter(t => t.kind === "goal").map(t => t.id));
    const archived = new Set<string>();
    for (const t of tasks) if(t.kind === "goal" && t.completedAt) { archived.add(t.id); for(const id of descendantIds(tasks,t.id)) archived.add(id); }
    const entries = tasks.filter(t => !t.completedAt && !archived.has(t.id) && (t.kind === "goal" || (t.kind === "step" && !!t.parentId && projects.has(t.parentId))));
    const dateOf = (t:Task) => t.kind === "goal" ? t.dueDate ?? t.weekDate ?? "" : t.plannedDate ?? t.dueDate ?? "";
    const byId = new Map(entries.map(t => [t.id, t]));
    const merged = new Set(entries.filter(t => t.parentId && t.dueDate && byId.get(t.parentId)?.dueDate === t.dueDate).map(t => t.id));
    const groups = new Map<string,Task[]>();
    for (const task of sorted(entries.filter(t => !merged.has(t.id)))) { const date=dateOf(task);groups.set(date,[...(groups.get(date) ?? []),task]); }
    const dates=[...groups.keys()].sort((a,b)=>!a ? 1 : !b ? -1 : a.localeCompare(b));
    return <section className="project-timeline" aria-label="项目时间轴">{!entries.length && <p className="project-empty">暂无进行中的项目或子任务。</p>}{dates.map(date=><section className={`timeline-group ${date === today ? "timeline-today" : ""}`} key={date || "unscheduled"} data-timeline-date={date}><header><h2>{date ? <time dateTime={date}>{Number(date.slice(5,7))}月{Number(date.slice(8))}日</time> : "尚未安排"}</h2><span className="timeline-weekday">{date ? new Date(`${date}T12:00:00+08:00`).toLocaleDateString("zh-CN",{weekday:"short",timeZone:"Asia/Shanghai"}) : "未安排日期"}</span><span>{date === today ? "今天 · " : date && date < today ? "此前安排 · " : ""}{groups.get(date)!.length} 项</span></header><div className="timeline-items">{groups.get(date)!.map(t=><div className="timeline-entry" key={t.id}><span className="timeline-kind">{t.kind === "goal" ? t.dueDate ? "项目截止" : t.weekDate ? "周目标项目" : "项目" : t.plannedDate ? "子任务计划" : t.dueDate ? "子任务截止" : "子任务"}</span>{t.kind === "goal" ? projectCard(t, merged) : row(t,undefined,0,true,true)}</div>)}</div></section>)}</section>;
  }

  function errorBanner(inDialog = false) {
    if (queueCount > 0 && !busy && error) return <div className="error-banner" role="alert"><strong>尚未保存 · {queueCount} 项操作</strong><p>{error}</p><p>本机变更已保留，请勿关闭页面。联网后可重试，或先导出未保存操作。</p><div className="banner-actions"><button type="button" onClick={() => void quickQueue.current?.reload()}>加载最新，保留待保存操作</button>{!conflict && <button type="button" onClick={() => void quickQueue.current?.retry()}>重试保存</button>}<button type="button" onClick={exportQueue}>导出未保存操作</button><button type="button" onClick={() => { if (window.confirm("取消尚未保存的变更？已保存的云端任务不受影响。")) void quickQueue.current?.discard(); }}>取消待保存操作</button></div></div>;
    if (busy || (!error && !pending.current)) return null;
    return <div className="error-banner" role="alert"><strong>{pending.current ? "尚未保存" : "连接提示"}</strong><p>{error || "最新计划已加载，请核对后重新保存。"}</p><div className="banner-actions"><button type="button" onClick={() => void refresh(true)} disabled={busy}><RefreshCw size={13} />加载最新{inDialog ? "，保留草稿" : ""}</button>{pending.current && !conflict && <button type="button" disabled={busy} onClick={() => { const p = pending.current; if (p) void mutate(p.operation, p.after, p.revision); }}>重试保存</button>}{pending.current && !inDialog && <button type="button" disabled={busy} onClick={() => { pending.current = null; setError(""); setConflict(false); void refresh(true); }}>取消待保存操作</button>}</div></div>;
  }
  if (!ready || (accessKey && !snapshot && !error)) return <div className="loading-screen"><Sun size={36} /><p>正在打开你的计划…</p></div>;
  if (!snapshot) return <main className="welcome"><div className="welcome-brand"><span className="brand-icon"><img src="/brand.svg?v=5" width={36} height={36} alt="" /></span><span>Cloud Plan</span></div><section className="welcome-copy"><div className="cloud-illustration" aria-hidden="true"><Cloud strokeWidth={1} /><span className="floating-check"><Check size={22} /></span><span className="orbit-dot" /></div><h1>让计划灵活，<br /><em>让生活轻盈。</em></h1><p className="welcome-intro">把要做的事记下来，专注于真正重要的事。</p><div className="welcome-demo" aria-label="静态示意任务"><header>今天的计划 <span>示意内容</span></header>{["整理学习笔记","完成个人作品集","傍晚散步"].map((title,i) => <div key={title}><span className={`demo-check ${i === 0 ? "done" : ""}`}>{i === 0 && <Check size={18}/>}</span><div className="demo-task-copy"><strong>{title}</strong><small><i/>{["个人学习","重要项目","生活"][i]}</small></div><time>{["09:00","14:00","19:00"][i]}</time><MoreHorizontal size={18}/></div>)}</div></section><form className="unlock-card" onSubmit={unlock}><span className="lock-symbol"><LockKeyhole size={26} /></span><h2>回到你的计划</h2><p>输入访问密钥，打开你的计划表。</p><label htmlFor="access-key">访问密钥</label><input id="access-key" type="password" autoComplete="off" autoFocus placeholder="输入你的 32 位访问密钥" value={keyInput} onChange={e => setKeyInput(e.target.value)} required minLength={32} maxLength={256} />{error && <p className="inline-error" role="alert">{error}</p>}<button className="primary wide" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight className="unlock-arrow" size={22} />}打开计划表</button><p className="unlock-note"><Cloud size={20}/>同一密钥，多设备同步。</p>{accessKey && <button type="button" className="text-button" onClick={() => void refresh(true)}>重新连接已记住的密钥</button>}</form></main>;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); setView("daily"); }}><span className="brand-icon"><img src="/brand.svg?v=5" width={36} height={36} alt="" /></span><span>Cloud Plan</span></a><div className="space-label">我的计划空间</div><nav aria-label="主导航">{([{ id: "daily", text: "每日计划", icon: CalendarDays }, { id: "goals", text: "项目管理", icon: Grid2X2 }, { id: "habits", text: "21天习惯", icon: Sprout }, { id: "history", text: "工作记录", icon: History }, { id: "settings", text: "设置", icon: Settings }] as const).map(item => <button className={`nav-item ${view === item.id ? "active" : ""}`} key={item.id} aria-label={item.id === "habits" ? "21天习惯养成" : item.id === "settings" ? "设置与备份" : item.text} title={item.id === "habits" && habitReminders > 0 ? `${habitReminders} 个习惯待打卡` : undefined} aria-describedby={item.id === "habits" && habitReminders > 0 ? "habit-reminder-status" : undefined} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}><span className="nav-icon"><item.icon size={19} />{item.id === "habits" && habitReminders > 0 && <span className="habit-reminder-dot" aria-hidden="true"/>}</span><span>{item.text}</span>{item.id === "daily" && <small>{tasks.filter(t => isDailyTask(t) && t.plannedDate === today && !t.completedAt).length}</small>}</button>)}</nav><span id="habit-reminder-status" className="sr-only" role="status">{habitReminders > 0 ? `${habitReminders} 个习惯已到提醒时间，今日尚未打卡` : ""}</span><div className="sidebar-bottom"><div className="private-space"><span><LockKeyhole size={15} /></span><div>我的私人计划</div></div></div></aside>
    <main className="main-panel"><header className="topbar"><span><span className="breadcrumb">Cloud Plan</span><ChevronRight size={13} />{{ daily: "每日计划", goals: "项目管理", habits: "21天习惯养成", history: "工作记录", settings: "设置与备份" }[view]}</span><button className={`sync-status ${error ? "sync-error" : ""}`} onClick={() => { if (quickQueue.current) void quickQueue.current.flush(); else void refresh(true); }} disabled={busy || !!error && queueCount > 0} title={queueCount ? "立即同步" : "刷新云端数据"}>{busy ? <LoaderCircle size={14} className="spin" /> : <Cloud size={14} />}<span>{busy ? "正在保存…" : error ? "连接异常" : queueCount ? "待同步 · 停止修改 30 秒后保存" : "已同步"}</span><span className="status-dot" /></button></header>
      <div className={`content view-${view} ${view === "goals" ? `goal-mode-${goalView}` : ""}`}>{queueCount > 0 && busy && <div className="notice" role="status">正在同步 {queueCount} 项操作，可继续修改计划。</div>}{errorBanner()}{notice && <div className="notice" role="status">{notice}<button className="icon-button" onClick={() => setNotice("")} aria-label="关闭提示"><X size={13} /></button></div>}
        <WorkTime accessKey={accessKey} visible={view === "history"} open={() => setView("history")}>{view === "history" && <CompletionChart tasks={tasks} today={today} selected={historyDate} onSelect={setHistoryDate} kind={historyKind} onKindChange={setHistoryKind} />}</WorkTime><Habits onReminderChange={setHabitReminders} tasks={tasks} revision={snapshot.revision} disabled={disabled} visible={view === "habits"} open={() => setView("habits")} save={mutate} remove={remove} />{view === "daily" && <><div className="page-heading"><div className="daily-heading-copy"><p>{selectedDate.slice(0,4)}年{shortDate(selectedDate)} · {new Date(`${selectedDate}T12:00:00+08:00`).toLocaleDateString("zh-CN",{weekday:"long",timeZone:"Asia/Shanghai"})}</p><div><h1>{selectedDate === today ? "今天的计划" : "这一天的计划"}</h1><span>{daily.length} 项待办</span></div></div><button className="primary" onClick={() => newTask()} disabled={dailyBlocked}><Plus size={18} />添加任务</button></div>
<section className="week-calendar"><div className="calendar-heading"><span>{shortDate(currentWeek)} — {shortDate(weekEnd)}</span><div className="date-nav"><button className="icon-button" aria-label="前一天" onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}><ChevronRight className="flip" size={17} /></button><label className="date-input"><CalendarDays size={15} /><input type="date" aria-label="计划日期" min="1900-01-01" max="2200-12-31" value={selectedDate} onChange={e => e.target.value && setSelectedDate(e.target.value)} /></label><button className="icon-button" aria-label="后一天" onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}><ChevronRight size={17} /></button><button className="today-button" onClick={() => setSelectedDate(today)}>今天</button></div><div className="week-actions"><button className="icon-button" aria-label="上一周" onClick={() => setSelectedDate(shiftDate(selectedDate, -7))}><ChevronRight className="flip" size={17}/></button><button className="today-button" onClick={() => setSelectedDate(today)}>本周</button><button className="icon-button" aria-label="下一周" onClick={() => setSelectedDate(shiftDate(selectedDate, 7))}><ChevronRight size={17}/></button></div></div>            <div className="week-strip" aria-label="整周每日安排">{Array.from({ length: 7 }, (_, i) => { const date = shiftDate(currentWeek, i); const items = sorted(weekDaily.filter(t => t.plannedDate === date)); const unfinished = items.filter(t => !t.completedAt); return <button key={date} data-plan-date={date} className={`${date === selectedDate ? "selected" : ""} ${dropDate === date ? "date-drop-target" : ""}`} aria-pressed={date === selectedDate} aria-label={`查看 ${date} 的每日计划`} onClick={() => setSelectedDate(date)}><span className="week-day">{["周一", "周二", "周三", "周四", "周五", "周六", "周日"][i]}{date === today && <b>今天</b>}</span><strong>{Number(date.slice(8))}</strong><span className="week-count"><i className={`calendar-count-dot ${unfinished.length ? "has-open" : ""}`}/>{items.length} 项</span><span className="week-preview">{unfinished[0]?.title ?? (items.length ? "全部完成 ✓" : "暂无安排")}</span></button>; })}</div></section><div className="daily-workspace"><div className="daily-layout"><section className="task-card"><div className="list-heading"><h2>今日清单</h2><span>{dailyDone} / {allDaily.length} 已完成</span></div><div className="daily-progress" role="progressbar" aria-label="每日完成进度" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${percent}%`}}/></div>
          {daily.length ? <div className="task-list">{daily.map((t, i) => row(t, daily, i, false, false, true))}</div> : <div className="empty-state"><span className="empty-icon"><ListTodo size={30} /></span><h3>{allDaily.length ? "这一天的待办已全部完成" : "留一点空间，给今天"}</h3>{allDaily.length > 0 && <button className="text-button" onClick={() => setView("history")}>查看工作记录 <ArrowRight size={14} /></button>}<button className="secondary" onClick={() => newTask()} disabled={disabled}><Plus size={16} />写下第一件事</button></div>}<button className="add-line" onClick={() => newTask()} disabled={disabled}><Plus size={16} />添加任务</button><details className="completed-subtasks daily-completed"><summary><ChevronRight size={16}/>已完成 · {dailyDone}</summary>{allDaily.filter(t => t.completedAt).map(t => row(t,undefined,0,true))}</details></section>
</div>
          <section className="week-plan" aria-label="周计划">
<div className="week-heading"><h2>本周重点</h2><button className="icon-button" aria-label="添加本周重点" onClick={() => newTask("weekly")} disabled={disabled}><Plus size={20}/></button></div>
            <div className="week-focus">{weeklyOpen.length ? weeklyOpen.map(t => t.kind === "goal" ? projectCard(t) : weeklyCard(t)) : <p className="week-empty">{weekly.length ? "这一周的重点已全部完成。" : "暂无本周重点"}</p>}{weekly.length > 0 && <span className="week-completion">已完成 {weekly.length - weeklyOpen.length} / {weekly.length} 项重点</span>}</div>

          <button className="text-button" onClick={() => setView("goals")}>查看全部项目 <ArrowRight size={16}/></button></section><details className="overdue-panel"><summary><span><History size={17} />往日未完成 <b>{overdue.length}</b></span><span className="summary-hint"><ChevronDown size={16} /></span></summary><div className="overdue-content">{overdue.length ? <><div className="roll-controls"><span>把这些事项安排到</span><input type="date" aria-label="批量顺延日期" min="1900-01-01" max="2200-12-31" value={rollDate} onChange={e => setRollDate(e.target.value)} /><button className="secondary small" disabled={disabled || !rollDate} onClick={() => void mutate({ type: "schedule", ids: overdue.map(t => t.id), date: rollDate })}>全部顺延</button><button className="text-button" disabled={disabled} onClick={() => void mutate({ type: "schedule", ids: overdue.map(t => t.id), date: today })}>全部移至今天</button></div>{overdue.map(t => row(t, undefined, 0, true))}</> : <p className="muted">暂无往日未完成任务</p>}</div></details></div></>}
        {view === "goals" && <><div className="project-heading-group"><div className="page-heading"><div><h1>项目管理</h1><span className="heading-count">{tasks.filter(t=>t.kind === "goal" && !t.parentId && !t.completedAt).length} 个进行中项目</span></div><button className="primary" disabled={disabled} onClick={() => newTask("goal")}><Plus size={18}/>新建项目</button></div><div className="goal-view-toolbar"><div className="goal-view-switch"><button aria-pressed={goalView === "list"} onClick={() => changeGoalView("list")}><ListTodo size={21} aria-hidden="true"/>项目列表</button><button aria-pressed={goalView === "quadrants"} onClick={() => changeGoalView("quadrants")}><Grid2X2 size={21} aria-hidden="true"/>子任务四象限</button><button aria-pressed={goalView === "timeline"} onClick={() => changeGoalView("timeline")}><CalendarDays size={21} aria-hidden="true"/>时间轴</button></div><div className="project-schedule"><label><CalendarDays size={18}/>安排日期 <input type="date" aria-label="项目安排日期" value={selectedDate} onChange={e => e.target.value && setSelectedDate(e.target.value)}/></label></div></div></div>
        {goalView === "list" ? <section className="projects-list" aria-label="项目列表"><div className="project-table-heading" aria-hidden="true"><span>项目 / 子任务</span><span>进度</span><span>截止日期</span><span>操作</span></div>{sorted(tasks.filter(t => t.kind === "goal" && !t.parentId && !t.completedAt)).map(t => projectCard(t))}{!tasks.some(t => t.kind === "goal" && !t.parentId && !t.completedAt) && <p className="project-empty">暂无进行中的项目。新建项目开始安排，已完成项目可在工作记录中查看。</p>}</section> : goalView === "timeline" ? projectTimeline() : <div className={`priority-matrix ${quadrantFilter !== null ? "filtered-matrix" : ""}`}><div className="quadrant-filter" role="group" aria-label="四象限分类筛选"><button aria-pressed={quadrantFilter === null} onClick={() => setQuadrantFilter(null)}>全部</button>{QUADRANTS.map((q,i) => <button key={q.color} aria-pressed={quadrantFilter === i} onClick={() => setQuadrantFilter(i)}>{q.title}</button>)}</div><div className="quadrant-grid"><div className="board-axes" aria-hidden="true"><span className="board-vertical"/><span className="board-horizontal"/><span className="board-importance">重要程度</span><span className="board-urgency">紧急程度</span></div>{QUADRANTS.map((q,i) => quadrantFilter !== null && quadrantFilter !== i ? null : <section key={q.color} data-quadrant={i} aria-label={q.title} className={`quadrant ${q.color} ${dropQuadrant === i ? "drop-target" : ""}`}><div className="quadrant-heading"><h2><i className="quadrant-dot"/>{q.title}</h2><span>{tasks.filter(t => t.kind === "step" && !t.completedAt && quadrant(t) === i).length} 项</span></div><SpatialTaskBoard tasks={tasks} onEditProject={edit}>{!tasks.some(t => t.kind === "step" && !t.completedAt && quadrant(t) === i) && <p className="matrix-empty">暂无子任务</p>}{sorted(tasks.filter(t => t.kind === "step" && !t.completedAt && quadrant(t) === i)).map(t => <div key={t.id} data-task-id={t.id} style={taskDriftStyle(t.id)} className={`matrix-step ${draggingId === t.id ? "matrix-card-dragging" : ""} ${matrixDetails === t.id ? "matrix-card-expanded" : ""}`}><button className="matrix-complete" disabled={disabled} aria-label={`完成四象限子任务：${t.title}`} title="完成子任务" onClick={()=>toggle(t)}><span/></button><button className="matrix-task-name" disabled={disabled} aria-label={`任务详情：${t.title}`} aria-expanded={matrixDetails === t.id} onClick={() => {if(suppressMatrixClick.current){suppressMatrixClick.current=false;return;}setMatrixDetails(matrixDetails === t.id ? null : t.id);}} onPointerDown={e=>startMatrixPress(e,t)} onPointerMove={moveMatrixPress} onPointerUp={endMatrixPress} onPointerCancel={()=>{suppressMatrixClick.current=true;cancelDrag();}} onLostPointerCapture={cancelDrag} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{if(e.key === "Escape")cancelDrag();if(e.key === "Enter" && e.shiftKey){e.preventDefault();setMatrixTask(t.id);}}} title="单击查看；鼠标按住拖动，触屏长按拖动；Shift+Enter 选择象限"><span>{t.title}</span>{t.dueDate && <small><CalendarDays size={13}/>{t.dueDate.slice(5).replace("-","/")}</small>}</button>{matrixDetails === t.id && <div className="matrix-task-details">{row(t,undefined,0,true,true)}</div>}</div>)}</SpatialTaskBoard></section>)}</div></div>}</>}
        {view === "history" && <section className="records-panel"><div className="page-heading"><div><h2 className="records-section-title">完成记录</h2></div><label className="history-filter">完成日期<input type="date" aria-label="完成日期筛选" value={historyDate.length === 10 ? historyDate : ""} onChange={e => setHistoryDate(e.target.value)} />{historyDate && <button className="text-button" onClick={() => setHistoryDate("")}>全部</button>}</label></div><label className="history-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="搜索已完成任务" placeholder="搜索已完成任务名称…" value={historySearch} onChange={e => setHistorySearch(e.target.value)} /></label><div className="history-selection" role="status"><span>{historyDate ? `${historyDate}${historyDate.length === 7 ? " 月" : ""}` : "全部时间"} · {({all:"全部类型",daily:"每日任务",step:"子任务",goal:"项目",weekly:"周重点"} as Record<string,string>)[historyKind]} · {completed.length} 项完成</span>{(historyDate || historyKind !== "all" || historySearch) && <button className="text-button" onClick={() => {setHistoryDate("");setHistoryKind("all");setHistorySearch("");}}>清除筛选</button>}</div><div className="goal-view-switch history-view-switch" role="group" aria-label="完成任务视图"><button aria-pressed={historyView === "time"} onClick={() => setHistoryView("time")}>按时间</button><button aria-pressed={historyView === "project"} onClick={() => setHistoryView("project")}>按项目</button></div><section className="task-card history-card">{!completed.length ? <div className="empty-state"><span className="empty-icon"><CheckCheck size={30} /></span><h3>{historyQuery ? "没有找到匹配的已完成任务" : historyDate || historyKind !== "all" ? "当前筛选下没有完成任务" : "这里会记下你的每一份努力"}</h3></div> : historyView === "project" ? completedByProject() : Object.entries(completed.reduce<Record<string, Task[]>>((groups, task) => { const date = beijingDate(new Date(task.completedAt!)); (groups[date] ??= []).push(task); return groups; }, {})).map(([date, items]) => <details className="history-group" key={date} data-history-date={date}><summary className="history-day"><ChevronRight className="history-chevron" size={18} aria-hidden="true" /><h2>{dateLabel(date)}</h2><span>{items.length} 项完成</span></summary>{items.map(t => t.kind === "goal" ? projectCard(t) : row(t, undefined, 0, true))}</details>)}</section></section>}
        {view === "settings" && <><div className="page-heading"><div><h1>设置与备份</h1></div></div><div className="settings-grid"><section className="settings-card"><span className="settings-symbol"><Cloud size={38} /></span><div className="settings-label"><h2>云端同步</h2><p>在多设备间同步你的任务数据</p></div><dl><div><dt>同步状态</dt><dd><i className={`settings-connection-dot ${error ? "is-error" : ""}`}/>{error ? "需要重试" : "已连接云端"}</dd></div><div><dt>最近同步</dt><dd>{lastSync?.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) ?? "—"}</dd></div><div><dt>日期时区</dt><dd>北京时间 UTC+8</dd></div><div><dt>任务数量</dt><dd>{tasks.length} 项</dd></div></dl><button className="secondary" disabled={busy} onClick={() => void refresh(true)}><RefreshCw size={15} />立即同步</button></section><section className="settings-card"><span className="settings-symbol"><Download size={36} /></span><div className="settings-label"><h2>备份与恢复</h2><p>导出备份或从备份文件恢复数据</p></div><p>导入会替换现有任务，并自动备份。工作时长需单独导出。</p><div className="backup-buttons"><button className="secondary" disabled={disabled} onClick={() => void exportBackup()}><Download size={15} />导出备份</button><button className="secondary" disabled={disabled} onClick={() => fileInput.current?.click()}><Upload size={15} />选择备份文件</button><input hidden ref={fileInput} type="file" accept=".json,application/json" onChange={e => { void previewImport(e.target.files?.[0]); e.target.value = ""; }} /></div>{importError && <p className="inline-error" role="alert">{importError}</p>}{importData && <div className="import-preview"><h3>备份校验通过</h3><p>{importData.tasks.length} 条任务 · {importData.tasks.filter(t => t.kind === "goal").length} 个项目 · {importData.tasks.filter(t => t.completedAt).length} 条已完成</p><p>导出于 {new Date(importData.exportedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p><button className="primary small" disabled={disabled} onClick={() => void restoreBackup()}>备份当前数据并替换</button><button className="text-button" onClick={() => setImportData(null)} disabled={busy}>取消</button></div>}</section><section className="settings-card key-card"><span className="settings-symbol"><KeyRound size={36} /></span><div className="settings-label"><h2>这台设备的访问密钥</h2><p>用于保护本机的数据访问</p></div><p className="key-note">忘记本机密钥不会删除云端任务。</p><button className="secondary" disabled={busy || queueCount > 0} onClick={forgetKey}><LogOut size={15} />忘记本机密钥</button></section></div></>}

      </div>
    </main>
    {matrixTask && <aside className="matrix-drop-tray" aria-label="移动到象限" onKeyDown={e => {if(e.key === "Escape")cancelDrag();}}><div className="matrix-drop-title"><strong>移动到</strong><button className="icon-button" aria-label="取消移动象限" onClick={cancelDrag}><X size={18}/></button></div><div className="matrix-drop-options">{QUADRANTS.map((q,i)=><button key={q.color} data-quadrant={i} className={dropQuadrant === i ? "drop-target" : ""} onClick={()=>{const id=matrixTask;cancelDrag();void mutate({type:"edit",id,changes:{important:q.important,urgent:q.urgent}});}}>{q.title}</button>)}</div></aside>}
    {matrixTask && dragPoint && <div className="matrix-drag-preview" aria-hidden="true" style={{left:dragPoint.x,top:dragPoint.y}}><GripVertical size={16}/>{tasks.find(t=>t.id===matrixTask)?.title}</div>}
    {scheduleTask && <aside className="schedule-drop-tray" aria-label="选择任务计划日期" onKeyDown={e => {if(e.key === "Escape")cancelDrag();}}><div><strong>拖到日期，安排每日计划</strong><button className="icon-button" aria-label="取消安排日期" onClick={cancelDrag}><X size={18}/></button></div><div className="schedule-drop-days">{Array.from({length:7},(_,i)=>{const date=shiftDate(currentWeek,i);return <button key={date} data-plan-date={date} className={dropDate === date ? "date-drop-target" : ""} onClick={()=>{const id=scheduleTask;cancelDrag();void mutate({type:"schedule",ids:[id],date});}} aria-label={`安排到 ${date}`}><span>{["周一","周二","周三","周四","周五","周六","周日"][i]}</span><strong>{date.slice(5).replace("-","/")}</strong></button>;})}</div></aside>}
    {draft && <dialog ref={dialogRef} className="task-dialog" onCancel={e => { e.preventDefault(); closeDraft(); }}><form onSubmit={saveDraft}><div className="dialog-heading"><div><h2>{draft.isNew ? "添加" : "编辑"}{draft.kind === "goal" ? "项目" : draft.kind === "step" ? "子任务" : draft.kind === "weekly" ? "周重点" : "每日任务"}</h2></div><button type="button" className="icon-button" aria-label="关闭编辑" onClick={closeDraft} disabled={formBusy}><X size={20} /></button></div>{errorBanner(true)}<label>任务名称<input autoFocus required maxLength={160} placeholder="你想完成什么？" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>{draft.parentId && <div className="parent-label"><FolderOpen size={14} />{tasks.find(t => t.id === draft.parentId)?.title ?? "所属任务已被删除"}</div>}<label>备注 <span>选填</span><textarea rows={3} maxLength={10000} placeholder="记下想法，或下一步要做的事…" value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label><div className="form-columns">{draft.kind !== "goal" && <label>{draft.kind === "weekly" ? "所属周（任选一天）" : "计划日期"} <span>{draft.kind === "step" ? "可稍后安排" : ""}</span><input type="date" min="1900-01-01" max="2200-12-31" required={draft.kind === "daily" || draft.kind === "weekly"} value={draft.plannedDate} onChange={e => setDraft({ ...draft, plannedDate: e.target.value })} /></label>}<label>截止日期 <span>选填</span><input type="date" min="1900-01-01" max="2200-12-31" value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} /></label></div>{draft.kind === "step" && <fieldset className="quadrant-picker"><legend>重要紧急分类</legend>{QUADRANTS.map(q => <label key={q.color} className={draft.important === q.important && draft.urgent === q.urgent ? "picked" : ""}><input type="radio" name="quadrant" checked={draft.important === q.important && draft.urgent === q.urgent} onChange={() => setDraft({ ...draft, important: q.important, urgent: q.urgent })} />{q.title}</label>)}</fieldset>}<div className="dialog-footer"><button className="primary" type="submit" disabled={formBusy || conflict || !draft.title.trim()}>{formBusy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存任务</button></div></form></dialog>}
  </div>;
}
