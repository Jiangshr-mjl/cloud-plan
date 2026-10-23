import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5173',key=(await readFile('outputs/access-key.txt','utf8')).trim();
async function api(operation){const get=()=>fetch(base+'/api/planner',{headers:{'X-Planner-Key':key}}).then(r=>r.json());if(!operation)return get();const s=await get();const r=await fetch(base+'/api/planner',{method:'POST',headers:{'X-Planner-Key':key,'Content-Type':'application/json'},body:JSON.stringify({revision:s.revision,operation})});assert.equal(r.status,200);return r.json();}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),id=crypto.randomUUID(),title='重点验收-'+id.slice(0,6);
await api({type:'create',task:{id,title,kind:'daily',parentId:null,notes:'',plannedDate:today,dueDate:null,important:false,urgent:false,order:0}});
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
try{
 await page.goto(base);await page.getByLabel('访问密钥',{exact:true}).fill(key);await page.getByRole('button',{name:'打开计划表',exact:true}).click();
 const saved=()=>page.waitForResponse(r=>r.url().endsWith('/api/planner')&&r.request().method()==='POST');let response=saved();await page.getByRole('button',{name:'标记重点：'+title,exact:true}).click();await response;
 assert.equal((await api()).tasks.find(t=>t.id===id).focusDate,today);
 await page.reload();await page.getByRole('button',{name:'取消重点：'+title,exact:true}).waitFor();assert.equal(await page.locator('.task-row.is-focus').filter({hasText:title}).count(),1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'tests/output/focus-mobile.png',fullPage:true});
 response=saved();await page.getByRole('button',{name:'取消重点：'+title,exact:true}).click();await response;assert.equal((await api()).tasks.find(t=>t.id===id).focusDate,null);
 console.log('PASS highlight toggle, server persistence, reload, mobile overflow');
}finally{await browser.close();await api({type:'delete',id});}
