"use client";
import {Children, isValidElement, useLayoutEffect, useRef, type ReactNode} from "react";
import type {Task} from "../lib/planner";

function variation(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}

// Each level owns its simulation: moving a project carries its descendants with it.
function BubbleArena({children}: {children: ReactNode}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const board = ref.current!;
    const nested = board.parentElement!.classList.contains("project-bubble");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let signature = "", frame = 0, previous = 0;
    let bodies: {el: HTMLElement; x:number; y:number; w:number; h:number; vx:number; vy:number; phase:number}[] = [];
    let width = 0, height = 0, dirty = true;
    const outline=(b: typeof bodies[number]) => b.el.classList.contains("project-bubble")
      ? Array.from({length:24},(_,i)=>[b.x+b.w/2+Math.cos(i*Math.PI/12)*b.w/2,b.y+b.h/2+Math.sin(i*Math.PI/12)*b.h/2])
      : [[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h],[b.x+b.w,b.y+b.h]];
    const layout = () => {
      const elements = Array.from(board.children).filter((el): el is HTMLElement => el instanceof HTMLElement && (el.classList.contains("project-bubble") || el.classList.contains("matrix-step")));
      width = board.clientWidth;
      const next = `${width}|${elements.map(el=>`${el.dataset.bubbleId || el.dataset.taskId}:${el.offsetWidth}:${el.offsetHeight}`).join("|")}`;
      if (!width || signature === next) return;
      signature = next;
      const gap = nested ? 10 : 32;
      const inset = nested ? width * .12 : 16;
      const rows: typeof bodies[] = [];
      let row: typeof bodies = [], used = 0;
      for(const el of elements){
        const w=el.offsetWidth,h=el.offsetHeight,key=el.dataset.bubbleId || el.dataset.taskId || "";
        if(row.length && used+gap+w>width-inset*2){rows.push(row);row=[];used=0;}
        row.push({el,x:0,y:0,w,h,vx:12+variation(key+"x")*14,vy:9+variation(key+"y")*12,phase:variation(key)*Math.PI*2});
        used+=(used?gap:0)+w;
      }
      if(row.length)rows.push(row);
      // The broadest bubbles occupy the ellipse's waist, smaller rows its tips.
      const ordered: typeof rows=[];
      for(const [i,r] of rows.sort((a,b)=>Math.max(...b.map(v=>v.h))-Math.max(...a.map(v=>v.h))).entries()){
        if(i%2)ordered.unshift(r);else ordered.push(r);
      }
      let y=0;
      bodies=[];
      for(const r of ordered){
        const h=Math.max(...r.map(b=>b.h));
        let x=(width-r.reduce((sum,b)=>sum+b.w,0)-gap*(r.length-1))/2;
        for(const b of r){b.x=x;b.y=y+(h-b.h)/2;x+=b.w+gap;bodies.push(b);}
        y+=h+gap;
      }
      const contentHeight=Math.max(0,y-gap);
      height=contentHeight+(nested?24:180);
      if(nested)for(const b of bodies)for(const [px,py] of outline(b)){
        const nx=(px-width/2)/(width/2);
        height=Math.max(height,2*Math.abs(py-contentHeight/2)/Math.sqrt(Math.max(.01,1-nx*nx))+24);
      }
      height=Math.max(100,height);
      for(const b of bodies)b.y+=(height-contentHeight)/2;
      board.style.height=`${height}px`;
      for(const b of bodies)b.el.style.transform=`translate3d(${b.x}px,${b.y}px,0)`;
    };
    const resize=new ResizeObserver(()=>{dirty=true;});
    const observe=()=>{resize.disconnect();resize.observe(board);for(const el of board.children)resize.observe(el);dirty=true;};
    const mutation=new MutationObserver(observe);
    mutation.observe(board,{childList:true,subtree:true,characterData:true});
    observe();layout();
    const overlaps=(a: typeof bodies[number],b: typeof bodies[number])=>a.x < b.x+b.w+8 && a.x+a.w+8>b.x && a.y<b.y+b.h+8 && a.y+a.h+8>b.y;
    const tick=(time:number)=>{
      const dt=Math.min((time-previous)/1000,.035);previous=time;
      if(dirty){dirty=false;layout();}
      // Freeze the complete branch while interacting; never move a target under a finger.
      const interacting=board.matches(":hover, :focus-within") || !!board.closest(".project-bubble:hover, .project-bubble:focus-within") || !!board.querySelector(".matrix-card-expanded, .matrix-card-dragging");
      if(!reduced.matches && !document.hidden && !interacting){
        for(const b of bodies){
          const oldX=b.x,oldY=b.y;
          const speed=1+.3*Math.sin(time/4700+b.phase);
          b.x+=b.vx*dt*speed;b.y+=b.vy*dt*speed;
          if(b.x<16 || b.x+b.w>width-16){b.x=Math.max(16,Math.min(b.x,width-16-b.w));b.vx*=-1;}
          if(b.y<16 || b.y+b.h>height-16){b.y=Math.max(16,Math.min(b.y,height-16-b.h));b.vy*=-1;}
          const outsideEllipse = nested && outline(b).some(([px,py])=>Math.pow((px-width/2)/(width/2),2)+Math.pow((py-height/2)/(height/2),2)>1);
          if(outsideEllipse || bodies.some(other=>other!==b && overlaps(b,other))){b.x=oldX;b.y=oldY;b.vx*=-1;b.vy*=-1;}
          b.el.style.transform=`translate3d(${b.x}px,${b.y}px,0)`;
        }
      }
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();};
  },[]);
  return <div className="bubble-arena" ref={ref}>{children}</div>;
}

type Branch={task:Task; children:Map<string,Branch>; cards:ReactNode[]};
export default function SpatialTaskBoard({children,tasks}: {children: ReactNode;tasks:Task[]}) {
  const roots=new Map<string,Branch>(),byId=new Map(tasks.map(t=>[t.id,t]));
  const loose:ReactNode[]=[];
  for(const card of Children.toArray(children)) {
    if(!isValidElement<{"data-task-id"?:string}>(card) || !card.props["data-task-id"]){loose.push(card);continue;}
    const task=byId.get(card.props["data-task-id"]!);
    const path:Task[]=[],seen=new Set<string>();
    let parent=task?.parentId;
    while(parent && !seen.has(parent)){seen.add(parent);const p=byId.get(parent);if(!p)break;path.unshift(p);parent=p.parentId;}
    let level=roots,branch:Branch|undefined;
    for(const p of path){if(!level.has(p.id))level.set(p.id,{task:p,children:new Map(),cards:[]});branch=level.get(p.id)!;level=branch.children;}
    if(branch)branch.cards.push(card);else loose.push(card);
  }
  const render=(branches:Map<string,Branch>):ReactNode=>Array.from(branches.values()).map(b=><section className="project-bubble" data-bubble-id={b.task.id} aria-label={b.task.title} key={b.task.id}><h3 className="project-bubble-title">{b.task.title}</h3><BubbleArena>{render(b.children)}{b.cards}</BubbleArena></section>);
  return <div className="goal-list spatial-task-board"><BubbleArena>{render(roots)}{loose}</BubbleArena></div>;
}
