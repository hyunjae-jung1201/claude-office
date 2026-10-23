import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksQuestion } from '../src/question.js';
import { normalizeEvent } from '../src/events.js';

test('asksQuestion: 끝부분에 물음표로 끝나는 줄이 있어야 질문', () => {
  assert.equal(asksQuestion('어느 방향으로 할까요?'), true);
  assert.equal(asksQuestion('정리했습니다.\n\n1번으로 할까요, 2번으로 할까요?\n- 1: 빠름\n- 2: 안전'), true);
  assert.equal(asksQuestion('Should I continue?'), true);
  assert.equal(asksQuestion('계속할까요？'), true);
  assert.equal(asksQuestion('**진행할까요?**'), true);
});

test('asksQuestion: 완료 보고나 "필요하면 말씀해 주세요" 같은 선택 안내는 질문이 아니다', () => {
  assert.equal(asksQuestion('수정했고 테스트도 통과했습니다.'), false);
  assert.equal(asksQuestion('끝났습니다.\n더 손볼 부분이 있으면 말씀해 주세요.'), false);
  assert.equal(asksQuestion('앞부분에서 왜 그런지 물었다?\n\n\n\n하지만 이후는 모두 보고입니다.\n테스트 통과.\n배포 완료.'), false); // 끝 세 줄 밖의 물음표는 무시
  assert.equal(asksQuestion(''), false);
  assert.equal(asksQuestion(undefined), false);
});

test('Stop hook 이벤트에 asksQuestion 이 실린다', () => {
  const mk = (msg) => normalizeEvent({ hook_event_name: 'Stop', session_id: 's', cwd: '/x', last_assistant_message: msg }, 1);
  assert.equal(mk('진행할까요?').asksQuestion, true);
  assert.equal(mk('완료했습니다.').asksQuestion, false);
});
