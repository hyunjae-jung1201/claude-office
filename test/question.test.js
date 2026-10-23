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

test('asksQuestion: 질문 뒤에 설명이 이어져도 질문이다(실제 Pin-It 응답)·존댓말 의문형도 인식', () => {
  const real = '  - 아쉬운 점: 도시 지도를 열 때 한 번 더 눌러야 합니다.\n\n  이 방식으로 진행해도 될까요? 괜찮으시면 작업 전에 최신 상태를 확인하고, 구현한 뒤 폰에서 확인하고 PR #106·#107에 반영하겠습니다.';
  assert.equal(asksQuestion(real), true);
  assert.equal(asksQuestion('이대로 진행할까요, 아니면 다른 방법을 볼까요'), true); // 물음표 없는 의문형
  assert.equal(asksQuestion('결과는 https://x.test/a?b=1 입니다.'), false); // URL 의 ? 는 질문이 아니다
  assert.equal(asksQuestion('필요하면 말씀해 주세요.'), false);
  assert.equal(asksQuestion('수정을 끝냈습니다. 확인해 보세요.'), false); // 단순 안내
});
