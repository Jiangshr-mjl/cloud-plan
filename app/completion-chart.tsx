"use client";
import { useState } from 'react';
import { beijingDate, type Task } from '@/lib/planner';
const TYPES = [
 {kind:'daily',label:'每日任务',color:'#2167b5'},
 {kind:'step',label:'长期子任务',color:'#40858c'},
 {kind:'goal',label:'长期任务',color:'#7975a0'},
 {kind:'weekly',label:'周重点',color:'#ae772c'},
] as const;
export default function CompletionChart({tasks,today,selected, onSelect,kind,onKindChange}:{tasks:Task[];today:string;selected:string;onSelect:(value:string)=>void;kind:string;onKindChange:(value:string)=>void}) {
 const [range,setRange]=useState('7');
 const monthly=range==='12';const n=Number(range);
 const buckets=Array.from({length:n},(_,i)=>{const d=new Date(today+'T12:00:00Z');if(monthly){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-(n-1-i));}else d.setUTCDate(d.getUTCDate()-(n-1-i));const key=d.toISOString().slice(0,monthly?7:10);return {key,label:monthly?key.slice(2):key.slice(5).replace('-','/'),count:0,counts:{daily:0,step:0,goal:0,weekly:0}};});
 for(const task of tasks){if(task.kind==='habit'||!task.completedAt||(kind!=='all'&&task.kind!==kind))continue;const key=beijingDate(new Date(task.completedAt)).slice(0,monthly?7:10);const bucket=buckets.find(b=>b.key===key);if(bucket){bucket.count++;bucket.counts[task.kind]++;}}
 const total=buckets.reduce((sum,b)=>sum+b.count,0),max=Math.max(1,...buckets.map(b=>b.count));
 return <section className="completion-chart" aria-label="完成量统计"><div className="chart-heading"><div><h2>完成量趋势</h2><p>这段时间完成 <strong>{total}</strong> 项 · {monthly?'按月':'按天'}统计</p></div><div className="chart-controls"><select aria-label="统计时间范围" value={range} onChange={e=>{setRange(e.target.value);onSelect('');}}><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="12">近 12 个月</option></select><select aria-label="统计任务类型" value={kind} onChange={e=>onKindChange(e.target.value)}><option value="all">全部类型</option><option value="daily">每日任务</option><option value="step">长期子任务</option><option value="goal">长期任务</option><option value="weekly">周重点</option></select></div></div><div className="chart-legend" aria-label="任务类型颜色图例">{TYPES.filter(t=>kind==='all'||kind===t.kind).map(t=><span key={t.kind}><i style={{background:t.color}} />{t.label}</span>)}</div><div className="chart-scroll"><div className="chart-bars" style={{minWidth:n>12?720:monthly?480:280}}>{buckets.map(b=><button type="button" className="chart-column" key={b.key} aria-pressed={selected===b.key} onClick={()=>onSelect(selected===b.key?'':b.key)} aria-label={`${b.key}：${b.count} 项`} title={`${b.key}：${b.count} 项；${TYPES.filter(t=>kind==='all'||kind===t.kind).map(t=>`${t.label} ${b.counts[t.kind]} 项`).join('，')}`}><span className="chart-track"><span className="chart-bar chart-stacked" style={{height:`${b.count/max*100}%`}}><b>{b.count}</b>{TYPES.filter(t=>b.counts[t.kind]>0).map(t=><span key={t.kind} className="chart-segment" aria-label={`${t.label}：${b.counts[t.kind]} 项`} title={`${b.key} · ${t.label}：${b.counts[t.kind]} 项`} style={{height:`${b.counts[t.kind]/b.count*100}%`,background:t.color}} />)}</span></span><span className="chart-label">{b.label}</span></button>)}</div></div>{total===0&&<p className="chart-empty">这段时间还没有完成记录。</p>}<details className="disclosure-note"><summary>统计说明</summary><p>按实际完成日期（北京时间）统计，点击柱子查看下方对应时间段的任务，再次点击可取消。全部类型按记录计数，长期任务与子任务分别计入；取消完成后移出统计。</p></details></section>;
}
