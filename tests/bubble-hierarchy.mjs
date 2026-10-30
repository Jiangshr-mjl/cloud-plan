import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'msedge'});
try{
 const page=await browser.newPage({viewport:{width:390,height:1000}}),now=new Date().toISOString();
 const base={id:randomUUID(),kind:'goal',parentId:null,title:'项目',notes:'',plannedDate:null,dueDate:null,important:true,urgent:false,order:0,completedAt:null,createdAt:now,updatedAt:now,version:0};
 const outer={...base,id:randomUUID(),title:'上级项目'};
 const parent={...base,id:randomUUID(),title:'待检查层级',parentId:outer.id};
 let tasks=[];
 await page.route('**/api/planner',r=>r.fulfill({json:{revision:0,tasks}}));
 await page.addInitScript(()=>localStorage.setItem('daylight.access-key','bubble-threshold-test-000000000000'));
 for(const count of [3,4]){
  const children=Array.from({length:count},(_,i)=>({...base,id:randomUUID(),parentId:parent.id,title:`子项目 ${i}`}));
  // Empty child projects still count, even though they have no task in this quadrant.
  const direct={...base,id:randomUUID(),kind:'step',parentId:parent.id,title:'直属任务'};
  const leaf={...direct,id:randomUUID(),parentId:children[0].id,title:'下级任务'};
  tasks=[outer,parent,...children,direct,leaf];
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('navigation').getByRole('button',{name:'项目管理',exact:true}).click();
  await page.getByRole('button',{name:'子任务四象限',exact:true}).click();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForTimeout(400);
  assert.equal(await page.locator(`[data-bubble-id="${parent.id}"]`).count(),count===3?1:0);
  assert.equal(await page.locator(`[data-bubble-id="${outer.id}"]`).count(),1);
  assert.equal(await page.locator(`[data-bubble-id="${children[0].id}"]`).count(),1);
  assert.equal(await page.locator('.matrix-step').count(),2);
  const expected=count===3?parent.id:outer.id;
  assert.equal(await page.locator(`[data-task-id="${direct.id}"]`).evaluate(el=>el.closest('.project-bubble').dataset.bubbleId),expected);
  await page.getByRole('group',{name:'四象限分类筛选'}).getByRole('button',{name:'重要不紧急',exact:true}).click();
  assert.equal(await page.locator(`[data-bubble-id="${parent.id}"]`).count(),count===3?1:0);
  await page.getByRole('button',{name:'任务详情：直属任务',exact:true}).click();
  await page.locator('.matrix-task-details').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log(count,'direct subprojects: visibility, promotion, task details and filtering passed');
 }
}finally{await browser.close();}
