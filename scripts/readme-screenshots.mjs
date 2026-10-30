// Capture the real local UI with browser-only fixtures; no database writes.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const base = 'http://127.0.0.1:5173';
import {tasks,day} from './ui-preview-fixtures.mjs';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1080},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/planner',r=>r.fulfill({json:{revision:1,tasks}}));
 await page.route('**/api/work-time',r=>r.fulfill({json:{days:Array.from({length:7},(_,i)=>({day:day(-i),seconds:[9600,14400,10800,7200,12600,5400,9000][i]}))}}));
 await mkdir('docs/images',{recursive:true});
 await page.goto(base);await page.getByRole('heading',{name:'回到你的计划'}).waitFor();
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);await page.screenshot({animations:'disabled',path:'docs/images/welcome.png',fullPage:true});
 await page.getByLabel('访问密钥',{exact:true}).fill('cloud-plan-demo-key-for-screenshots');
 await page.getByRole('button',{name:'打开计划表',exact:true}).click();
 await page.getByRole('heading',{name:'今天的计划'}).waitFor();
 async function capture(name){await page.evaluate(()=>window.scrollTo(0,0));await page.mouse.move(0,0);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);await page.screenshot({animations:'disabled',path:`docs/images/${name}.png`,fullPage:name!=='mobile'});}
 async function nav(name){await page.getByRole('navigation').getByRole('button',{name,exact:name!=='每日计划'}).click();}
 await page.locator('.daily-completed>summary').click();await capture('daily'); await nav('项目管理');
 await page.locator('summary').filter({hasText:'完成个人作品集'}).click();
 await page.locator('summary').filter({hasText:'内容与视觉设计'}).click();await capture('goals-list');
 await page.getByRole('button',{name:'子任务四象限',exact:true}).click();await capture('goals');await page.getByRole('button',{name:'时间轴',exact:true}).click();await page.locator('.project-timeline .project-card').first().locator(':scope > summary').click();await capture('timeline'); await nav('21天习惯养成');await capture('habits');
 await nav('工作记录');await page.locator('.work-summary strong').first().filter({hasText:'2小时'}).waitFor();await page.locator('.history-group>summary').first().click();await capture('work');await page.getByRole('button',{name:'按项目',exact:true}).click();await capture('history-projects');
 await nav('设置与备份');await capture('settings');
 await page.setViewportSize({width:390,height:1050});await nav('21天习惯养成');await capture('mobile');
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Captured 10 screenshots with demo data.');
} finally {await browser.close();}
