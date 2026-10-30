import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
// Requires npm run dev and npm run preview:ui; all mutations stay in preview memory.
const base='http://127.0.0.1:5174';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
 page.setDefaultTimeout(15000);page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/review');
 const frame=page.frameLocator('#app');
 const screens={daily:'.daily-layout',list:'.projects-list',quadrants:'.spatial-task-board',timeline:'.project-timeline',habits:'.habits-grid',history:'.records-charts',settings:'.settings-grid',welcome:'.welcome'};
 for(const [screen,selector] of Object.entries(screens)) {
  await page.selectOption('#screen',screen);
  await frame.locator(selector).first().waitFor({state:'visible'});
  await page.waitForFunction(()=>{const i=document.querySelector('#concept');return i.complete&&i.naturalWidth>0;});
  await page.locator('[data-mode=concept]').click();assert.equal(await page.locator('#app').isVisible(),false);
  await page.locator('[data-mode=overlay]').click();assert.equal(await page.locator('#opacity-label').isVisible(),true);
  await page.locator('#opacity').fill('35');assert.equal(await page.locator('#concept').evaluate(e=>getComputedStyle(e).opacity),'0.35');
  await page.locator('[data-mode=actual]').click();assert.equal(await page.locator('#concept').isVisible(),false);
  console.log('Preview controls and concept loaded:',screen);
 }
 console.log('Checking habit dismissal');await page.goto(base+'/?screen=habits');
 const dismiss=page.getByRole('button',{name:'收起提醒说明'});await dismiss.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.habit-notifications').count(),0);
 console.log('Checking quadrant actions');await page.goto(base+'/?screen=quadrants');await page.emulateMedia({reducedMotion:'reduce'});
 const edit=page.getByRole('button',{name:'编辑气泡项目：完成个人作品集',exact:true}).first();await edit.click();console.log('Opened project editor');
 await page.getByRole('dialog').waitFor();assert.equal(await page.getByLabel('任务名称',{exact:true}).inputValue(),'完成个人作品集');await page.getByRole('button',{name:'关闭编辑',exact:true}).click();
 const complete=page.locator('.matrix-complete').first();const title=(await complete.getAttribute('aria-label')).replace('完成四象限子任务：','');
 await complete.click();console.log('Completed task',title);await page.getByTitle('立即同步',{exact:true}).click();await page.getByText('已同步',{exact:true}).waitFor();
 const state=await (await page.request.get(base+'/api/planner')).json();assert.ok(state.tasks.find(t=>t.title===title)?.completedAt,'completion control updates its actual task');
 assert.equal((await page.request.get(base+'/api/unknown')).status(),404);
 assert.deepEqual(errors,[]);
 await page.goto(base+'/review');await page.frameLocator('#app').locator('.daily-layout').waitFor();await mkdir('tests/output',{recursive:true});await page.screenshot({path:'tests/output/local-review.png'});
 console.log('Keyboard dismissal, project editing, task completion and API isolation passed.');
}finally{await browser.close();}
