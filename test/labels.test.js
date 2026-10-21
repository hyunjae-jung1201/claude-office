import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleLabel } from '../src/labels.js';

const ev = (category, detail, type = 'tool') => ({ sessionId: 's', cwd: '/c', ts: 0, type, category, detail });

test('작업 종류별 기본 문구', () => {
  assert.equal(ruleLabel(ev('read')), '파일 읽는 중');
  assert.equal(ruleLabel(ev('write')), '코드 작성 중');
  assert.equal(ruleLabel(ev('run')), '명령 실행 중');
  assert.equal(ruleLabel({ sessionId: 's', cwd: '/c', ts: 0, type: 'wait' }), '승인 기다리는 중');
});

test('파일 경로가 있으면 파일 이름을 넣는다', () => {
  assert.equal(ruleLabel(ev('read', '/work/a/data/notes.txt')), 'notes.txt 읽는 중');
  assert.equal(ruleLabel(ev('write', '/work/a/src/server.js')), 'server.js 수정 중');
});

test('명령은 첫 단어만 쓰고, 20자를 넘으면 …로 줄인다', () => {
  assert.equal(ruleLabel(ev('run', 'npm test -- --watch')), 'npm 실행 중');
  const long = ruleLabel(ev('read', '/x/' + 'a'.repeat(60) + '.txt'));
  assert.ok(long.length <= 20, long);
  assert.ok(long.includes('…'));
});

test('wait 종류별 문구', () => {
  const w = (waitKind) => ({ sessionId: 's', cwd: '/c', ts: 0, type: 'wait', waitKind });
  assert.equal(ruleLabel(w('approval')), '승인 기다리는 중');
  assert.equal(ruleLabel(w('answer')), '답변 기다리는 중');
  assert.equal(ruleLabel(w('plan')), '계획 승인 기다리는 중');
  assert.equal(ruleLabel(w(undefined)), '승인 기다리는 중');
});
