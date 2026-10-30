import assert from 'node:assert/strict';
import {applyOperation} from '../lib/planner.ts';
// Capture the real local UI with browser-only fixtures; no database writes.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:5173';
const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day = offset => { const d=new Date(today+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+offset); return d.toISOString().slice(0,10); };
const monday = day(-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7));
const tasks=[];
function task(title,kind='daily',extra={}) { const t={id:randomUUID(),kind,title,notes:'',parentId:null,plannedDate:kind==='daily'?today:null,dueDate:null,important:false,urgent:false,order:tasks.length,completedAt:null,createdAt:today+'T02:00:00Z',updatedAt:today+'T02:00:00Z',version:1,...extra};tasks.push(t);return t; }
const goal=task('完成个人作品集','goal',{important:true,notes:'整理代表作品，让每一步积累都有清晰的方向。',dueDate:day(21),weekDate:monday});
const subproject=task('内容与视觉设计','goal',{parentId:goal.id,notes:'先梳理内容，再完成页面表达。',dueDate:day(10)});
task('整理三个代表项目','step',{parentId:subproject.id,plannedDate:today,important:true,dueDate:day(10)});
task('确定作品集结构','step',{parentId:goal.id,completedAt:day(-1)+'T08:00:00Z'});
task('准备周末分享','step',{parentId:goal.id,important:true,urgent:true,dueDate:day(2)});
task('预约设备检修','step',{parentId:goal.id,urgent:true,dueDate:day(1)});
task('整理旅行灵感','step',{parentId:goal.id,notes:'收集想去的地方，慢慢完善路线。'});
task('阅读并整理学习笔记'); task('傍晚散步三十分钟');
task('完成一周回顾','daily',{completedAt:today+'T03:00:00Z'});
task('打磨作品集首页','weekly',{plannedDate:monday,notes:'本周聚焦结构与内容，周末回顾进展。'});
task('每天阅读二十分钟','habit',{plannedDate:day(-7),habit:{checks:[-7,-6,-5,-3,-2,-1,0].map(day),reminder:null},notes:'每天留一点安静的时间，读书并记录一个想法。'});
task('每天活动三十分钟','habit',{plannedDate:day(-4),habit:{checks:[-4,-3,-1].map(day),reminder:null}});
for(let i=1;i<7;i++) task(['整理学习资料','练习页面排版','完成读书笔记','整理本周安排','完成设计草图','回顾项目进度'][i-1],'daily',{plannedDate:day(-i),completedAt:day(-i)+'T09:00:00Z'});
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 let state={revision:1,tasks};
 await page.route('**/api/planner',async r=>{if(r.request().method()==='POST'){const {operation}=r.request().postDataJSON();state={revision:state.revision+1,tasks:applyOperation(state.tasks,operation,state.revision+1)};}await r.fulfill({json:state});});
 await page.route('**/api/work-time',r=>r.fulfill({json:{days:[]}}));
 await page.goto(base);assert.equal(await page.locator('.welcome h1').innerText(),'让计划灵活，\n让生活轻盈。');assert.equal(await page.getByRole('navigation').count(),0);
 await page.getByLabel('访问密钥',{exact:true}).fill('ui-approved-browser-test-key-000000');await page.getByRole('button',{name:'打开计划表',exact:true}).click();
 await page.getByRole('button',{name:'暂停计时',exact:true}).click();
 assert.equal(await page.evaluate(()=>localStorage.getItem('cloud-plan.work-paused')),'true');
 assert.equal(await page.locator('.work-timer-readout strong').innerText(),'00:00');
 await page.getByRole('button',{name:'恢复计时',exact:true}).focus();await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>localStorage.getItem('cloud-plan.work-paused')),'false');
 const nav=async name=>page.getByRole('navigation').getByRole('button',{name,exact:name!=='每日计划'}).click();
 const fit=async label=>{await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label);};
 for(const width of [1440,1360,820,390,360]) {
  await page.setViewportSize({width,height:1000});
  await nav('每日计划');await fit(`${width} daily`);assert.equal(await page.locator('.week-strip>button').count(),7);assert.equal(await page.locator('.week-focus>.project-card>summary>.lucide-flag').count(),1);
  await page.locator('.task-list .task-options>summary').first().click();await fit(`${width} task menu`);await page.keyboard.press('Tab');await page.locator('.task-list .task-options>summary').first().click();
  await nav('项目管理');for(const name of ['项目列表','子任务四象限','时间轴']){await page.getByRole('button',{name,exact:true}).click();await fit(`${width} ${name}`);}
  await nav('21天习惯养成');assert.equal(await page.locator('.habit-days button').count(),42);await fit(`${width} habits`);
  await nav('工作记录');await fit(`${width} records`);await page.getByRole('button',{name:'按项目',exact:true}).click();await fit(`${width} history`);
  await nav('设置与备份');await fit(`${width} settings`);
  console.log(width,'all pages fit, calendar/flags/habit counts correct');
 }
 await nav('21天习惯养成');page.on('dialog',d=>d.accept());const habit=page.locator('.habit-card').nth(1);await habit.getByRole('button',{name:'今日打卡',exact:true}).click();await page.getByTitle('立即同步',{exact:true}).click();await page.getByText('已同步',{exact:true}).waitFor();assert.ok(state.tasks.find(t=>t.title==='每天活动三十分钟').habit.checks.includes(today));await habit.getByRole('button',{name:`每天活动三十分钟 ${today} 撤销打卡`,exact:true}).click();await page.getByTitle('立即同步',{exact:true}).click();await page.getByText('已同步',{exact:true}).waitFor();assert.ok(!state.tasks.find(t=>t.title==='每天活动三十分钟').habit.checks.includes(today));
 await nav('项目管理');await page.getByRole('button',{name:'子任务四象限',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(300);const still=await page.locator('.bubble-arena>.matrix-step').first().getAttribute('style');await page.waitForTimeout(200);assert.equal(await page.locator('.bubble-arena>.matrix-step').first().getAttribute('style'),still);
 state={revision:state.revision+1,tasks:[]};await page.reload();for(const name of ['每日计划','项目管理','21天习惯养成','工作记录','设置与备份']){await nav(name);await fit('empty '+name);}
 assert.deepEqual(errors,[]);console.log('Habit check/undo, unlock boundary, reduced motion and console passed');
} finally {await browser.close();}
