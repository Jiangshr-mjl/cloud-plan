import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge'});const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const task=(title,kind='daily',n=0)=>({id:`00000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,kind,parentId:null,title,notes:'检查中文长文本与日期信息的显示',plannedDate:kind==='goal'?null:today,dueDate:null,important:true,urgent:false,order:n,completedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:0,...(kind==='habit'?{habit:{checks:[],reminder:null}}:{})});
await page.route('**/api/planner',route=>route.fulfill({json:{revision:0,tasks:[task('整理本周工作计划'),task('检查长任务标题在手机上是否完整显示，并保留排序、编辑及重点操作','daily',1),task('推进长期学习目标','goal',2),task('每日阅读','habit',3)]}}));
await page.addInitScript(()=>localStorage.setItem('daylight.access-key','ui-review-fixture-key-00000000000000'));
await mkdir('tests/output/ui-review',{recursive:true});const results=[];
for(const width of [1360,820,390,360]){
 await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5173');await page.getByRole('navigation').waitFor();await page.evaluate(()=>document.fonts.ready);
 for(const name of ['每日计划','长期任务','21 天习惯','工作记录','设置与备份']){
 await page.getByRole('navigation').getByRole('button',{name,exact:name!=='每日计划'}).click();await page.waitForTimeout(150);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`${width} ${name}: page overflow`);results.push({width,name,overflow});
 await page.screenshot({path:`tests/output/ui-review/${width}-${name}.png`,fullPage:true});
 if(name==='长期任务'){
  await page.getByRole('button',{name:'列表',exact:true}).click();await page.locator('.goals-list-view').waitFor();
  await page.getByRole('button',{name:'四象限',exact:true}).click();await page.locator('.priority-matrix').waitFor();
 }
 if(name==='21 天习惯'){
  await page.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('.habit-editor').waitFor();
  assert.equal(await page.locator('.habit-editor').getByRole('textbox').first().inputValue(),'每日阅读');
  await page.getByRole('button',{name:'取消',exact:true}).click();
 }

 }
 await page.getByRole('navigation').getByRole('button',{name:'每日计划'}).click();
 const dateBefore=await page.getByLabel('计划日期',{exact:true}).inputValue();
 await page.getByRole('button',{name:'后一天',exact:true}).click();assert.notEqual(await page.getByLabel('计划日期',{exact:true}).inputValue(),dateBefore);
 await page.getByRole('button',{name:'前一天',exact:true}).click();assert.equal(await page.getByLabel('计划日期',{exact:true}).inputValue(),dateBefore);
 await page.getByRole('button',{name:'添加任务',exact:true}).first().click();await page.locator('dialog').waitFor();await page.screenshot({path:`tests/output/ui-review/${width}-dialog.png`});await page.keyboard.press('Escape');
}
await page.addInitScript(()=>localStorage.removeItem('daylight.access-key'));await page.reload();await page.getByRole('heading',{name:'回到你的计划'}).waitFor();await page.screenshot({path:'tests/output/ui-review/welcome.png',fullPage:true});
await writeFile('tests/output/ui-review/results.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));await browser.close();assert.deepEqual(errors,[]);

