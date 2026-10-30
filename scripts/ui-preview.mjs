// Isolated local review host. All API calls use in-memory fixtures; never forward them.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {tasks,day} from './ui-preview-fixtures.mjs';
import {applyOperation} from '../lib/planner.ts';
const root=new URL('../',import.meta.url),port=5174;
let state={revision:1,tasks:structuredClone(tasks)};
const screens=['daily','list','quadrants','timeline','habits','history','settings','welcome'];
const images=['01-daily','02-project-list','03-quadrants','04-timeline','05-habits','06-work-records','07-settings','08-welcome'];
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:'+port);
 if(req.headers.host!==`127.0.0.1:${port}`&&req.headers.host!==`localhost:${port}`){res.writeHead(403);res.end();return;}
 if(url.pathname==='/api/planner'){
  if(req.method==='POST'){let raw='';for await(const c of req){raw+=c;if(raw.length>2e6)throw Error('request too large');}const body=JSON.parse(raw);if(body.revision!==state.revision)return json(res,{error:'数据版本已改变，请重新载入'},409);state={revision:state.revision+1,tasks:applyOperation(state.tasks,body.operation,state.revision+1)};}
  return json(res,state);
 }
 if(url.pathname==='/api/work-time')return json(res,{days:Array.from({length:7},(_,i)=>({day:day(-i),seconds:[9600,14400,10800,7200,12600,5400,9000][i]}))});
 if(url.pathname.startsWith('/api/'))return json(res,{error:'Local review only'},404);
 if(url.pathname==='/review'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(await readFile(new URL('scripts/ui-review.html',root)));return;}
 if(url.pathname.startsWith('/__concept/')){const name=url.pathname.slice(11);if(!images.includes(name))return json(res,{error:'Not found'},404);res.writeHead(200,{'Content-Type':'image/png'});res.end(await readFile(new URL(`docs/ui-approved-2026-10-30/images/${name}.png`,root)));return;}
 if(req.method!=='GET'&&req.method!=='HEAD')return json(res,{error:'Local review only'},405);
 const upstream=await fetch('http://127.0.0.1:5173'+url.pathname+url.search,{headers:{accept:req.headers.accept||'*/*'}});
 const type=upstream.headers.get('content-type')||'application/octet-stream';res.writeHead(upstream.status,{'Content-Type':type,'Cache-Control':'no-store'});
 if(type.includes('text/html')){
  const screen=screens.includes(url.searchParams.get('screen'))?url.searchParams.get('screen'):'daily';
  const boot=`<script>localStorage.removeItem('cloud-plan.work-paused');localStorage.setItem('cloud-plan.goal-view','list');${screen==='welcome'?"localStorage.removeItem('daylight.access-key');":"localStorage.setItem('daylight.access-key','local-review-demo-key-not-a-real-key');"}window.addEventListener('DOMContentLoaded',()=>{const screen=${JSON.stringify(screen)},nav={daily:'每日计划',list:'项目管理',quadrants:'项目管理',timeline:'项目管理',habits:'21天习惯养成',history:'工作记录',settings:'设置与备份'};let step=0;const timer=setInterval(()=>{if(screen==='welcome')return clearInterval(timer);const n=[...document.querySelectorAll('nav button')].find(b=>b.getAttribute('aria-label')===nav[screen]);if(!n)return;if(step===0){n.click();step=1;return;}const name={list:'项目列表',quadrants:'子任务四象限',timeline:'时间轴'}[screen];if(name){const b=[...document.querySelectorAll('.goal-view-switch button')].find(b=>b.textContent===name);if(!b)return;b.click();}if(screen==='list'){const ds=document.querySelectorAll('.projects-list .project-card');if(!ds.length)return;ds.forEach(d=>d.open=true);}if(screen==='daily'){const d=document.querySelector('.daily-completed');if(!d)return;d.open=true;}if(screen==='history'){const d=document.querySelector('.history-group');if(!d)return;d.open=true;}if(screen==='timeline'){const d=document.querySelector('.project-timeline .project-card');if(!d)return;d.open=true;}clearInterval(timer);},150);setTimeout(()=>clearInterval(timer),10000);});</script>`;
  res.end((await upstream.text()).replace('<head>','<head>'+boot));
 }else res.end(Buffer.from(await upstream.arrayBuffer()));
}catch(e){json(res,{error:e.message},500);}}).listen(port,'127.0.0.1',()=>console.log(`Local UI review: http://127.0.0.1:${port}/review (isolated demo data)`));
