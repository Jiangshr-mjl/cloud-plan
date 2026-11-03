"use client";
import {useRef,useState} from "react";
import {Plus} from "lucide-react";
export default function QuickSubtask({parentTitle,disabled,onAdd,hidden=false}:{parentTitle:string;disabled:boolean;hidden?:boolean;onAdd:(title:string,accepted:()=>void)=>void}){
 const [title,setTitle]=useState("");
 const input=useRef<HTMLInputElement>(null);
 return <form hidden={hidden} className="weekly-quick-add" onSubmit={e=>{e.preventDefault();if(disabled||!title.trim())return;onAdd(title.trim(),()=>{setTitle("");input.current?.focus();});}}>
  <input ref={input} aria-label={`添加子任务：${parentTitle}`} placeholder="添加子任务…" maxLength={160} value={title} disabled={disabled} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key === "Enter" && e.nativeEvent.isComposing)e.preventDefault();}}/>
  <button type="submit" aria-label={`确认添加子任务：${parentTitle}`} disabled={disabled||!title.trim()}><Plus size={18}/>添加</button>
 </form>;
}
