import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { applyOperation, beijingDate, weekStart } from '../lib/planner.ts';

const browser = await chromium.launch({ channel: 'msedge' });
const today = beijingDate();
const errors = [];
await mkdir('tests/output/subtasks', { recursive: true });
try {
  for (const width of [1360, 390, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => dialog.accept());
    const make = (title, kind, parentId = null) => ({ id: randomUUID(), title, kind, parentId, notes: '', plannedDate: kind === 'weekly' ? weekStart(today) : null, dueDate: null, important: true, urgent: false, order: 1, completedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 0 });
    const weekly = make('本周发布计划', 'weekly');
    const goal = make('长期学习计划', 'goal');
    const step = make('阅读并整理笔记', 'step', goal.id);
    let snapshot = { revision: 0, tasks: [weekly, goal, step] };
    let failNext = false;
    await page.route('**/api/planner', async route => {
      if (route.request().method() === 'POST') {
        if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: '测试保存失败' } }); }
        const body = route.request().postDataJSON();
        assert.equal(body.revision, snapshot.revision);
        snapshot = { revision: snapshot.revision + 1, tasks: applyOperation(snapshot.tasks, body.operation, snapshot.revision + 1) };
      }
      await route.fulfill({ json: snapshot });
    });
    await page.addInitScript(() => localStorage.setItem('daylight.access-key', 'subtask-test-key-00000000000000000'));
    await page.goto('http://127.0.0.1:5173');
    await page.getByRole('button', { name: '添加子任务：本周发布计划', exact: true }).click();
    await page.getByLabel('任务名称').fill('检查发布内容和所有页面的交互状态');
    await page.getByRole('button', { name: '保存任务', exact: true }).click();
    await page.locator('dialog').waitFor({ state: 'hidden' });
    const child = snapshot.tasks.find(t => t.parentId === weekly.id);
    assert.ok(child);
    assert.equal(child.plannedDate, null);
    const scheduleName = `加入 ${today} 每日计划：${child.title}`;
    // A failed save must roll back and remain retryable without duplicating records.
    failNext = true;
    await page.getByRole('button', { name: scheduleName, exact: true }).click();
    await page.getByText('测试保存失败', { exact: true }).waitFor();
    assert.equal(snapshot.tasks.find(t => t.id === child.id).plannedDate, null);
    await page.getByRole('button', { name: '重试保存', exact: true }).click();
    await page.getByRole('button', { name: `已加入 ${today} 每日计划：${child.title}`, exact: true }).waitFor();
    assert.equal(snapshot.tasks.length, 4);
    assert.equal(snapshot.tasks.find(t => t.id === child.id).plannedDate, today);
    assert.equal(await page.getByRole('button', { name: `已加入 ${today} 每日计划：${child.title}`, exact: true }).isDisabled(), true);
    await page.getByRole('navigation').getByRole('button', { name: '项目管理', exact: true }).click();
    await page.locator('summary').filter({hasText:'长期学习计划'}).click();
    await page.getByRole('button', { name: `加入 ${today} 每日计划：${step.title}`, exact: true }).click();
    await page.getByRole('button', { name: `已加入 ${today} 每日计划：${step.title}`, exact: true }).waitFor();
    assert.equal(snapshot.tasks.length, 4);
    assert.equal(snapshot.tasks.find(t => t.id === step.id).parentId, goal.id);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `tests/output/subtasks/${width}-goals.png`, fullPage: true });
    await page.getByRole('navigation').getByRole('button', { name: '每日计划' }).click();
    const daily = page.locator('.task-list');
    await daily.getByRole('button', { name: `编辑：${child.title}`, exact: true }).waitFor();
    await daily.getByRole('button', { name: `编辑：${step.title}`, exact: true }).waitFor();
    await daily.getByRole('button', { name: `完成：${child.title}`, exact: true }).click();
    await page.getByRole('button', { name: `取消完成：${child.title}`, exact: true }).waitFor();
    assert.ok(snapshot.tasks.find(t => t.id === child.id).completedAt);
    await page.getByRole('button', { name: `取消完成：${child.title}`, exact: true }).click();
    await daily.getByRole('button', { name: `编辑：${child.title}`, exact: true }).waitFor();
    assert.equal(snapshot.tasks.find(t => t.id === child.id).completedAt, null);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `tests/output/subtasks/${width}-daily.png`, fullPage: true });
    await page.reload();
    await daily.getByRole('button', { name: `编辑：${child.title}`, exact: true }).waitFor();
    await page.getByRole('button', { name: `删除：${weekly.title}`, exact: true }).click();
    await daily.getByRole('button', { name: `编辑：${child.title}`, exact: true }).waitFor({ state: 'hidden' });
    assert.equal(snapshot.tasks.length, 2);
    assert.ok(snapshot.tasks.some(t => t.id === step.id));
    console.log(`${width}px: create, retry, schedule both parents, complete/undo, reload, cascade delete passed`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
