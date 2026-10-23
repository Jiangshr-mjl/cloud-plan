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
const goal=task('完成个人作品集','goal',{important:true,notes:'整理代表作品，让每一步积累都有清晰的方向。',dueDate:day(21)});
task('整理三个代表项目','step',{parentId:goal.id,plannedDate:today});
task('确定作品集结构','step',{parentId:goal.id,completedAt:day(-1)+'T08:00:00Z'});
task('准备周末分享','goal',{important:true,urgent:true,dueDate:day(2)});
task('预约设备检修','goal',{urgent:true,dueDate:day(1)});
task('整理旅行灵感','goal',{notes:'收集想去的地方，慢慢完善路线。'});
task('阅读并整理学习笔记'); task('傍晚散步三十分钟');
task('完成一周回顾','daily',{completedAt:today+'T03:00:00Z'});
task('打磨作品集首页','weekly',{plannedDate:monday,notes:'本周聚焦结构与内容，周末回顾进展。'});
task('每天阅读二十分钟','habit',{plannedDate:day(-7),habit:{checks:[-7,-6,-5,-3,-2,-1,0].map(day),reminder:null},notes:'每天留一点安静的时间，读书并记录一个想法。'});
task('每天活动三十分钟','habit',{plannedDate:day(-4),habit:{checks:[-4,-3,-1].map(day),reminder:null}});
for(let i=1;i<7;i++) task(['整理学习资料','练习页面排版','完成读书笔记','整理本周安排','完成设计草图','回顾项目进度'][i-1],'daily',{plannedDate:day(-i),completedAt:day(-i)+'T09:00:00Z'});
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1080},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/planner',r=>r.fulfill({json:{revision:1,tasks}}));
 await page.route('**/api/work-time',r=>r.fulfill({json:{days:Array.from({length:7},(_,i)=>({day:day(-i),seconds:[9600,14400,10800,7200,12600,5400,9000][i]}))}}));
 await mkdir('docs/images',{recursive:true});
 await page.goto(base);await page.getByRole('heading',{name:'回到你的计划'}).waitFor();
 await page.screenshot({path:'docs/images/welcome.png',fullPage:true});
 await page.getByLabel('访问密钥',{exact:true}).fill('cloud-plan-demo-key-for-screenshots');
 await page.getByRole('button',{name:'打开计划表',exact:true}).click();
 await page.getByRole('heading',{name:'今天，也从容一点。'}).waitFor();
 async function capture(name){await page.mouse.move(0,0);await page.evaluate(()=>document.fonts.ready);await page.screenshot({animations:'disabled',path:`docs/images/${name}.png`,fullPage:name!=='mobile'});}
 async function nav(name){await page.getByRole('navigation').getByRole('button',{name,exact:name!=='每日计划'}).click();}
 await capture('daily'); await nav('长期任务');
 await page.getByRole('button',{name:'完成个人作品集',exact:true}).click();await capture('goals');
 await page.getByRole('button',{name:'列表',exact:true}).click();await capture('goals-list');
 await nav('21 天习惯');await capture('habits');
 await nav('工作记录');await page.locator('.work-summary strong').first().filter({hasText:'2 小时'}).waitFor();await capture('work');
 await nav('设置与备份');await capture('settings');
 await page.setViewportSize({width:390,height:1050});await nav('21 天习惯');await capture('mobile');
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Captured 8 screenshots with demo data.');
} finally {await browser.close();}
