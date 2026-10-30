import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
await mkdir('tests/output/spatial-board',{recursive:true});
const browser=await chromium.launch({channel:'msedge'});
try {
 const page=await browser.newPage({viewport:{width:1360,height:1000}}),now=new Date().toISOString();
 const root={id:randomUUID(),kind:'goal',parentId:null,title:'Cloud Plan',notes:'',plannedDate:null,dueDate:null,important:true,urgent:false,order:0,completedAt:null,createdAt:now,updatedAt:now,version:0};
 const names=['整理灵感','设计首页','检查手机端长标题和任务详情在空间布局中的显示','完成图标','优化导航布局','准备上线','回顾反馈','下一步'];
 const sub={...root,id:randomUUID(),parentId:root.id,title:'界面细节'};
 const tasks=[root,sub,...names.map((title,i)=>({...root,id:randomUUID(),kind:'step',parentId:i<3?sub.id:root.id,title,order:i,notes:i===0?'这里是任务详情，用于检查展开后其他卡片是否让出空间。':'',urgent:false})),{...root,id:randomUUID(),kind:'step',parentId:root.id,title:'确认优先事项',urgent:true}];
 await page.route('**/api/planner',r=>r.fulfill({json:{revision:0,tasks}}));
 await page.addInitScript(()=>localStorage.setItem('daylight.access-key','spatial-board-test-key-0000000000'));
 await page.goto('http://127.0.0.1:5173');
 await page.getByRole('navigation').getByRole('button',{name:'项目管理',exact:true}).click();
 await page.getByRole('button',{name:'子任务四象限',exact:true}).click();
 assert.equal(await page.locator('.project-bubble .project-bubble').count(),1);
 await page.mouse.move(0,0);
 await page.evaluate(()=>document.activeElement?.blur());
 const moving=page.locator('.matrix-step').last();
 const start=await moving.boundingBox();
 await page.waitForTimeout(3500);
 const end=await moving.boundingBox();
 assert.ok(Math.hypot(end.x-start.x,end.y-start.y)>25,'bubbles travel freely rather than merely wobble');
 await page.emulateMedia({reducedMotion:'reduce'});
 const stopped=await moving.getAttribute('style');await page.waitForTimeout(150);
 assert.equal(await moving.getAttribute('style'),stopped);
 await page.emulateMedia({reducedMotion:'no-preference'});
 const check=async()=>{
   for(let second=0;second<=3;second++){
     const errors=await page.locator('.bubble-arena').evaluateAll((boards,second)=>boards.flatMap(board=>{
       const cards=[...board.querySelectorAll(':scope > .matrix-step, :scope > .project-bubble')];
       for(const card of cards)for(const a of card.getAnimations()){a.pause();a.currentTime=second*1000;}
       const bounds=board.getBoundingClientRect(),rects=cards.map(c=>c.getBoundingClientRect()),errors=[];
       rects.forEach((r,i)=>{if(r.left<bounds.left||r.right>bounds.right||r.top<bounds.top||r.bottom>bounds.bottom)errors.push(`outside ${i}`);for(let j=0;j<i;j++){const b=rects[j];if(r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top)errors.push(`overlap ${i},${j}`);}});
       return errors;
     }),second);
     assert.deepEqual(errors,[]);
     await page.waitForTimeout(250);
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 };
 for(const width of [1360,820,390,320]) {
   await page.setViewportSize({width,height:1000});
   await page.waitForTimeout(600);
   await check();
   await page.emulateMedia({reducedMotion:'reduce'});
   const card=page.getByRole('button',{name:'任务详情：整理灵感',exact:true});
   await card.click();await page.locator('.matrix-task-details').waitFor();
   await page.waitForTimeout(600);await check();
   await card.click();
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.getByRole('group',{name:'四象限分类筛选'}).getByRole('button',{name:'重要不紧急',exact:true}).click();
   await page.waitForTimeout(600);await check();
   await page.screenshot({path:`tests/output/spatial-board/${width}.png`,fullPage:true});
   await page.getByRole('group',{name:'四象限分类筛选'}).getByRole('button',{name:'全部',exact:true}).click();
   console.log(width,'motion envelope, expanded details, resizing and filtering do not overlap');
 }
} finally {await browser.close();}
