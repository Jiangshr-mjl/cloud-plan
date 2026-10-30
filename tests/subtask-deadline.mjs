import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {applyOperation} from '../lib/planner.ts';
const browser=await chromium.launch({channel:'msedge'});
try {
  const page=await browser.newPage();
  const now=new Date().toISOString();
  const project={id:randomUUID(),kind:'goal',parentId:null,title:'日期项目',notes:'',plannedDate:null,dueDate:'2027-05-20',important:true,urgent:false,order:0,completedAt:null,createdAt:now,updatedAt:now,version:0};
  const undated={...project,id:randomUUID(),title:'无日期项目',dueDate:null};
  let state={revision:0,tasks:[project,undated]};
  await page.route('**/api/planner',async r=>{if(r.request().method()==='POST'){const {operation}=r.request().postDataJSON();state={revision:state.revision+1,tasks:applyOperation(state.tasks,operation,state.revision+1)};}await r.fulfill({json:state});});
  await page.addInitScript(()=>localStorage.setItem('daylight.access-key','deadline-test-key-00000000000000000'));
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('navigation').getByRole('button',{name:'项目管理',exact:true}).click();
  await page.getByRole('button',{name:'项目列表',exact:true}).click();
  const card=page.locator(`[data-project-id="${project.id}"]`);
  await card.locator(':scope > summary').click();
  for(const [title,date] of [['默认日期','2027-05-20'],['自选日期','2027-05-15'],['清空日期','']]) {
    await card.getByRole('button',{name:'添加子任务',exact:true}).click();
    const due=page.getByLabel('截止日期');
    assert.equal(await due.inputValue(),'2027-05-20');
    await due.fill(date);
    await page.getByLabel('任务名称').fill(title);
    await page.getByRole('button',{name:'保存任务',exact:true}).click();
    await page.locator('dialog').waitFor({state:'hidden'});
    assert.equal(state.tasks.find(t=>t.title===title).dueDate,date||null);
  }
  const emptyCard=page.locator(`[data-project-id="${undated.id}"]`);
  await emptyCard.locator(':scope > summary').click();
  await emptyCard.getByRole('button',{name:'添加子任务',exact:true}).click();
  assert.equal(await page.getByLabel('截止日期').inputValue(),'');
  assert.equal(state.tasks[0].dueDate,'2027-05-20');
  console.log('Inherited deadline, manual override, clearing, and undated project passed');
} finally {await browser.close();}
