import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'msedge'});
await mkdir('tests/output/quadrants',{recursive:true});
try {for(const width of [320,360,390,430,640,768,1360]) {
  const page=await browser.newPage({viewport:{width,height:844}});
  const now=new Date().toISOString();
  const root={id:randomUUID(),kind:'goal',parentId:null,title:'跨团队协作项目与长名称测试',notes:'',plannedDate:null,dueDate:null,important:true,urgent:false,order:0,completedAt:null,createdAt:now,updatedAt:now,version:0};
  const tasks=[root,...[0,1,2,3].flatMap((q)=>[0,1].map(i=>({...root,id:randomUUID(),kind:'step',parentId:root.id,title:`象限${q}任务${i}：核对移动页面布局与所有按钮完整显示LongUnbrokenTaskNameForMobile`,plannedDate:'2026-10-30',dueDate:'2027-12-31',important:q<2,urgent:q%2===0})))];
  await page.route('**/api/planner',r=>r.fulfill({json:{revision:0,tasks}}));
  await page.addInitScript(()=>localStorage.setItem('daylight.access-key','quadrants-test-key-0000000000000'));
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('navigation').getByRole('button',{name:'项目管理',exact:true}).click();
  await page.getByRole('button',{name:'子任务四象限',exact:true}).click();
  const regions=await page.locator('.priority-matrix .quadrant').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width,top:r.top,bottom:r.bottom};}));
  assert.equal(regions.length,4);
  for(const r of regions) assert.ok(r.x>=0&&r.right<=width,`${width}: quadrant outside screen ${JSON.stringify(r)}`);
  if(width<=640) for(let i=1;i<4;i++) {assert.ok(regions[i].top>=regions[i-1].bottom);assert.ok(Math.abs(regions[i].width-regions[0].width)<1);}
  const clipped=await page.locator('.matrix-step .task-title, .matrix-step button').evaluateAll(nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect(),q=n.closest('.quadrant').getBoundingClientRect();return r.left<q.left||r.right>q.right+1||r.bottom>q.bottom+1||(n.textContent.trim() && n.scrollWidth>n.clientWidth+1);}).map(n=>({text:n.textContent,cls:n.className,sw:n.scrollWidth,cw:n.clientWidth,rect:n.getBoundingClientRect().toJSON(),q:n.closest(".quadrant").getBoundingClientRect().toJSON()})));
  assert.deepEqual(clipped,[],`${width}: clipped content`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`tests/output/quadrants/${width}.png`,fullPage:true});
  await page.getByRole('button',{name:`编辑：${tasks[1].title}`,exact:true}).click();
  await page.locator('dialog').waitFor();
  await page.close();
  console.log(width,'all quadrants and task controls fit');
}} finally {await browser.close();}
