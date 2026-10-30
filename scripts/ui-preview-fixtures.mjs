// Local review and screenshots only; never imported by the app.
import {randomUUID} from 'node:crypto';
export const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const day = offset => { const d=new Date(today+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+offset); return d.toISOString().slice(0,10); };
const monday = day(-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7));
export const tasks=[];
function task(title,kind='daily',extra={}) { const t={id:randomUUID(),kind,title,notes:'',parentId:null,plannedDate:kind==='daily'?today:null,dueDate:null,important:false,urgent:false,order:tasks.length,completedAt:null,createdAt:today+'T02:00:00Z',updatedAt:today+'T02:00:00Z',version:1,...extra};tasks.push(t);return t; }
const goal=task('完成个人作品集','goal',{important:true,notes:'整理代表作品，让每一步积累都有清晰的方向。',dueDate:day(21),weekDate:monday});
const subproject=task('内容与视觉设计','goal',{parentId:goal.id,notes:'先梳理内容，再完成页面表达。',dueDate:day(10)});
task('整理三个代表项目','step',{parentId:subproject.id,plannedDate:today,focusDate:today,important:true,dueDate:day(10)});
task('确定作品集结构','step',{parentId:goal.id,completedAt:day(-1)+'T08:00:00Z'});
task('准备周末分享','step',{parentId:goal.id,important:true,urgent:true,dueDate:day(2)});
task('预约设备检修','step',{parentId:goal.id,urgent:true,dueDate:day(1)});
task('整理旅行灵感','step',{parentId:goal.id,notes:'收集想去的地方，慢慢完善路线。'});
task('阅读并整理学习笔记'); task('傍晚散步三十分钟');
task('完成一周回顾','daily',{completedAt:today+'T03:00:00Z'});
task('打磨作品集首页','weekly',{plannedDate:monday,notes:'本周聚焦结构与内容，周末回顾进展。'});
task('每天阅读二十分钟','habit',{plannedDate:day(-7),habit:{checks:[-7,-6,-5,-3,-2,-1,0].map(day),reminder:'20:00'},notes:'读书并记录一个想法'});
task('每天活动三十分钟','habit',{plannedDate:day(-4),habit:{checks:[-4,-3,-1].map(day),reminder:'18:30'},notes:'散步、跑步或任何运动方式'});
for(let i=1;i<7;i++) task(['整理学习资料','练习页面排版','完成读书笔记','整理本周安排','完成设计草图','回顾项目进度'][i-1],'daily',{plannedDate:day(-i),completedAt:day(-i)+'T09:00:00Z'});
