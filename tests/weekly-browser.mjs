import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base='http://127.0.0.1:5173';
const key=(await readFile('outputs/access-key.txt','utf8')).trim();
async function api(operation){let state=await (await fetch(base+'/api/planner',{headers:{'X-Planner-Key':key}})).json();if(!operation)return state;const r=await fetch(base+'/api/planner',{method:'POST',headers:{'X-Planner-Key':key,'Content-Type':'application/json'},body:JSON.stringify({revision:state.revision,operation})});assert.equal(r.status,200);return r.json();}
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1360,height:1000}});page.on('dialog',d=>d.accept());const errors=[];page.on('pageerror',e=>errors.push(e.message));
const saved=()=>page.waitForFunction(()=>!document.querySelector('.topbar .spin'));
const nav=async(name)=>{await saved();await page.getByRole('navigation').getByRole('button',{name,exact:name!=='每日计划'}).click();};
try{
 await api({type:'import',backup:{format:'daylight-planner',schemaVersion:1,timezone:'Asia/Shanghai',exportedAt:new Date().toISOString(),tasks:[]}});
 await page.goto(base);await page.getByLabel('访问密钥',{exact:true}).fill(key);await page.getByRole('button',{name:'打开计划表',exact:true}).click();
 const week=page.getByRole('region',{name:'周计划',exact:true});await week.waitFor();assert.equal(await week.locator('.week-strip>button').count(),7);
 await week.getByRole('button',{name:'添加本周重点',exact:true}).click();await page.getByLabel('任务名称',{exact:true}).fill('本周推进论文方法章节');await page.getByLabel('备注').fill('优先把数据分析路线理清，再完成方法初稿。');await page.getByRole('button',{name:'保存任务',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});await saved();
 let snapshot=await api();const weekly=snapshot.tasks.find(t=>t.kind==='weekly');assert.ok(weekly);assert.equal(new Date(weekly.plannedDate+'T12:00Z').getUTCDay(),1);assert.equal(await page.locator('.day-overview>div').first().locator('strong').innerText(),'0项待完成');
 await week.getByRole('button',{name:'下一周',exact:true}).click();assert.equal(await week.getByRole('button',{name:'编辑：本周推进论文方法章节',exact:true}).count(),0);await week.getByRole('button',{name:'上一周',exact:true}).click();await week.getByRole('button',{name:'编辑：本周推进论文方法章节',exact:true}).waitFor();
 await week.getByRole('button',{name:'编辑：本周推进论文方法章节',exact:true}).click();await page.getByLabel('备注').fill('周三完成方法初稿，周五复核。');await page.getByRole('button',{name:'保存任务',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});await saved();assert.equal((await api()).tasks.find(t=>t.kind==='weekly').notes,'周三完成方法初稿，周五复核。');
 await page.getByRole('button',{name:'添加任务',exact:true}).click();await page.getByLabel('任务名称',{exact:true}).fill('整理分析数据');await page.getByRole('button',{name:'保存任务',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});await saved();assert.ok((await week.locator('.week-count').allTextContents()).includes('1 待办 / 1 项'));
 await week.locator('.week-strip>button').first().click();assert.equal(await page.getByLabel('计划日期',{exact:true}).inputValue(),weekly.plannedDate);
 await week.getByRole('button',{name:'本周',exact:true}).click();await week.getByRole('button',{name:'完成：本周推进论文方法章节',exact:true}).click();await saved();await week.getByText('这一周的重点已全部完成。',{exact:true}).waitFor();
 await nav('工作记录');await page.getByRole('button',{name:'取消完成：本周推进论文方法章节',exact:true}).click();await saved();await nav('每日计划');await week.getByRole('button',{name:'编辑：本周推进论文方法章节',exact:true}).waitFor();
 await page.reload();await week.getByRole('button',{name:'编辑：本周推进论文方法章节',exact:true}).waitFor();
 await mkdir('tests/output',{recursive:true});await page.screenshot({path:'tests/output/weekly-desktop.png',fullPage:true});
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.goto(base);await mobile.getByLabel('访问密钥',{exact:true}).fill(key);await mobile.getByRole('button',{name:'打开计划表',exact:true}).click();await mobile.getByRole('button',{name:'编辑：本周推进论文方法章节',exact:true}).waitFor();assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mobile.screenshot({path:'tests/output/weekly-mobile.png',fullPage:true});await mobile.close();
 const data=await api();await api({type:'import',backup:{format:'daylight-planner',schemaVersion:1,timezone:'Asia/Shanghai',exportedAt:new Date().toISOString(),tasks:data.tasks}});assert.equal((await api()).tasks.find(t=>t.id===weekly.id).kind,'weekly');
 assert.deepEqual(errors,[]);console.log('PASS weekly create/edit/switch/daily counts/navigation/complete/undo/reload/second device/mobile/backup');
}finally{await browser.close();}
