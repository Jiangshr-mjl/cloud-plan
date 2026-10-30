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
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let signature = "", frame = 0, previous = 0;
    let bodies: {el: HTMLElement; x:number; y:number; w:number; h:number; vx:number; vy:number; phase:number}[] = [];
    let width = 0, height = 0, dirty = true;
    const layout = () => {
      const elements = Array.from(board.children).filter((el): el is HTMLElement => el instanceof HTMLElement && (el.classList.contains("project-bubble") || el.classList.contains("matrix-step")));
      width = board.clientWidth;
      const next = `${width}|${elements.map(el=>`${el.dataset.bubbleId || el.dataset.taskId}:${el.offsetWidth}:${el.offsetHeight}`).join("|")}`;
      if (!width || signature === next) return;
      signature = next;
      let x = 16, y = 16, rowHeight = 0;
      bodies = elements.map(el => {
        const w=el.offsetWidth,h=el.offsetHeight,key=el.dataset.bubbleId || el.dataset.taskId || "";
        if(x > 16 && x+w > width-16){x=16;y+=rowHeight+48;rowHeight=0;}
        const body={el,x,y:y+variation(key)*20,w,h,vx:12+variation(key+"x")*14,vy:9+variation(key+"y")*12,phase:variation(key)*Math.PI*2};
        x+=w+32;rowHeight=Math.max(rowHeight,h+20);
        return body;
      });
      height = bodies.length ? y+rowHeight+104 : 100;
      board.style.height=`${height}px`;
      for(const b of bodies)b.el.style.transform=`translate3d(${b.x}px,${b.y}px,0)`;
    };
    const resize=new ResizeObserver(()=>{dirty=true;});
    const observe=()=>{resize.disconnect();resize.observe(board);for(const el of board.children)resize.observe(el);dirty=true;};
    const mutation=new MutationObserver(observe);
    mutation.observe(board,{childList:true,subtree:true,characterData:true});
    observe();layout();
    const overlaps=(a: typeof bodies[number],b: typeof bodies[number])=>a.x < b.x+b.w+12 && a.x+a.w+12>b.x && a.y<b.y+b.h+12 && a.y+a.h+12>b.y;
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
          if(bodies.some(other=>other!==b && overlaps(b,other))){b.x=oldX;b.y=oldY;b.vx*=-1;b.vy*=-1;}
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
