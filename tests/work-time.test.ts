import {test} from 'node:test';import assert from 'node:assert/strict';import {mergeSpans,splitDays,spanSeconds} from '../lib/work-time';
test('重叠标签页、设备与重复上传只计一次',()=>{assert.deepEqual(mergeSpans([[0,30000],[10000,45000],[0,30000],[60000,90000]]),[[0,45000],[60000,90000]]);assert.equal(spanSeconds([[0,30000],[10000,45000],[0,30000],[60000,90000]]),75);});
test('跨北京时间午夜按天拆分，重复边界不增加时长',()=>{const start=Date.parse('2026-10-22T15:59:30Z'),end=start+60000;const days=splitDays([[start,end]]);assert.equal(spanSeconds(days['2026-10-22']),30);assert.equal(spanSeconds(days['2026-10-23']),30);});
