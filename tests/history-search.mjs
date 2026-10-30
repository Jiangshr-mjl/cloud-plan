import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
const browser = await chromium.launch({channel:'msedge'});
try {
  for (const width of [1360,390]) {
    const page = await browser.newPage({viewport:{width,height:1000}});
    const now = new Date().toISOString();
    const tasks = ['整理研究资料','研究报告 Cloud','周会准备','研究未完成'].map((title,i)=>({id:randomUUID(),kind:'daily',parentId:null,title,notes:'',plannedDate:'2026-10-30',dueDate:null,important:false,urgent:false,order:i,completedAt:i===3?null:now,createdAt:now,updatedAt:now,version:0}));
    await page.route('**/api/planner',r=>r.fulfill({json:{revision:0,tasks}}));
    await page.addInitScript(()=>localStorage.setItem('daylight.access-key','history-search-test-key-0000000000'));
    await page.goto('http://127.0.0.1:5173');
    await page.getByRole('navigation').getByRole('button',{name:'工作记录',exact:true}).click();
    const search = page.getByRole('searchbox',{name:'搜索已完成任务'});
    const titles = page.locator('.history-card .task-title');
    await search.fill('研究');
    await page.waitForFunction(()=>document.querySelectorAll('.history-card .task-title').length===2);
    assert.deepEqual(await titles.allTextContents(),['整理研究资料','研究报告 Cloud']);
    await search.fill(' cloud ');
    await page.waitForFunction(()=>document.querySelectorAll('.history-card .task-title').length===1);
    assert.equal(await titles.first().textContent(),'研究报告 Cloud');
    await search.fill('.*');
    await page.getByText('没有找到匹配的已完成任务',{exact:true}).waitFor();
    await page.getByRole('button',{name:'清除筛选',exact:true}).click();
    assert.equal(await search.inputValue(),'');
    assert.equal(await titles.count(),3);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    console.log(width,'completed task substring search passed');
    await page.close();
  }
} finally {await browser.close();}
