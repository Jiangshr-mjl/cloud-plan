import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { applyOperation, beijingDate, weekStart } from '../lib/planner.ts';

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const browser = await chromium.launch({ channel: 'msedge' });
try {
  for (const width of [1360, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const today = beijingDate(), now = new Date().toISOString();
    const base = { notes: '保留备注', dueDate: null, important: true, urgent: false, order: 0, completedAt: null, createdAt: now, updatedAt: now, version: 0 };
    const project = { ...base, id: randomUUID(), kind: 'goal', parentId: null, title: '关联项目', plannedDate: null };
    const daily = { ...base, id: randomUUID(), kind: 'daily', parentId: null, title: '每日迁移任务', plannedDate: today };
    const step = { ...base, id: randomUUID(), kind: 'step', parentId: project.id, title: '项目迁移子任务', plannedDate: today };
    let state = { revision: 0, tasks: [project, daily, step] };
    await page.route('**/api/planner', async route => {
      if (route.request().method() === 'POST') {
        const { operation } = route.request().postDataJSON();
        state = { revision: state.revision + 1, tasks: applyOperation(state.tasks, operation, state.revision + 1) };
      }
      await route.fulfill({ json: state });
    });
    await page.addInitScript(() => localStorage.setItem('daylight.access-key', 'daily-drag-test-key-0000000000000'));
    await page.goto('http://127.0.0.1:5173');
    const targetDate = shiftDate(weekStart(today), today === weekStart(today) ? 1 : 0);
    for (const task of [daily, step]) {
      const handle = page.getByRole('button', { name: `拖动安排日期：${task.title}`, exact: true });
      await handle.scrollIntoViewIfNeeded();
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + 15, box.y + 15);
      await page.mouse.down();
      const target = page.locator(`.schedule-drop-days [data-plan-date="${targetDate}"]`);
      await target.waitFor();
      const position = await target.boundingBox();
      await page.mouse.move(position.x + 15, position.y + 25, { steps: 12 });
      await page.locator('.schedule-drop-days .date-drop-target').waitFor();
      await page.mouse.up();
      await handle.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelector('.sync-status')?.textContent?.includes('已同步'));
      const moved = state.tasks.find(t => t.id === task.id);
      assert.equal(moved.plannedDate, targetDate);
      assert.equal(moved.parentId, task.parentId);
      assert.equal(moved.notes, task.notes);
      assert.equal(state.tasks.length, 3);
    }
    await page.getByLabel('计划日期', { exact: true }).fill(targetDate);
    for (const task of [daily, step]) await page.getByRole('button', { name: `拖动安排日期：${task.title}`, exact: true }).waitFor();
    await page.getByRole('button', { name: `拖动安排日期：${daily.title}`, exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.locator('.schedule-drop-tray').waitFor({ state: 'hidden' });
    assert.equal(state.tasks.find(t => t.id === daily.id).plannedDate, targetDate);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log(width, 'daily and project subtask migration, cancellation, and layout passed');
    await page.close();
  }
} finally { await browser.close(); }
