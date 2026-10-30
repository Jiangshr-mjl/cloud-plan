import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
let server={revision:0,tasks:[]},posts=0;
await page.route('**/api/planner',async route=>{const req=route.request();if(req.method()==='POST'){posts++;const {operation:op}=req.postDataJSON();server.revision++;if(op.type==='create')server.tasks.push({...op.task,version:server.revision,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),completedAt:null});if(op.type==='edit')Object.assign(server.tasks.find(t=>t.id===op.id),op.changes);}await route.fulfill({json:server});});
await page.route('**/api/work-time',route=>route.fulfill({json:{days:[]}}));
try{
await page.goto('http://127.0.0.1:5173');
await page.getByLabel('访问密钥',{exact:true}).fill('test-key-'.repeat(5));await page.getByRole('button',{name:'打开计划表',exact:true}).click();
await page.getByRole('button',{name:'添加任务',exact:true}).first().click();await page.getByLabel('任务名称',{exact:true}).fill('延迟同步测试');await page.getByRole('button',{name:'保存任务',exact:true}).click();
await page.getByRole('button',{name:'编辑：延迟同步测试',exact:true}).click();await page.getByLabel('任务名称',{exact:true}).fill('连续编辑成功');await page.getByRole('button',{name:'保存任务',exact:true}).click();
assert.equal(posts,0);assert.equal(await page.getByRole('button',{name:'完成：连续编辑成功',exact:true}).isEnabled(),true);
await page.getByTitle('立即同步',{exact:true}).click();await page.getByText('已同步',{exact:true}).waitFor();assert.equal(posts,2);assert.equal(server.tasks[0].title,'连续编辑成功');assert.deepEqual(errors,[]);console.log('PASS: 创建及编辑即时生效、延迟期间不上传、控件可继续使用、手动同步成功');
}finally{await browser.close();}
