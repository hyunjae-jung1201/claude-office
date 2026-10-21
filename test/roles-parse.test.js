import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoleOutput, aggregateVerdict, countConcerns } from '../src/roles/parse.js';

const ok = { verdict: 'ok', summary: '문제 없음', findings: [] };
const json = (o) => JSON.stringify(o);

test('정상 JSON', () => {
  const r = parseRoleOutput(json({ verdict: 'concern', summary: '입력 검증 누락', findings: [{ severity: 'major', text: '빈 값 처리 없음', file: 'src/a.js', line: 12 }] }), 'dev');
  assert.deepEqual(r, { roleId: 'dev', verdict: 'concern', summary: '입력 검증 누락', findings: [{ severity: 'major', text: '빈 값 처리 없음', file: 'src/a.js', line: 12 }] });
});

test('코드 펜스, 앞뒤 설명, 중괄호가 든 문자열 값을 견딘다', () => {
  const body = json({ verdict: 'ok', summary: '정상 {중괄호} 포함', findings: [] });
  for (const text of ['```json\n' + body + '\n```', '검토 결과입니다.\n' + body + '\n이상입니다.', '```\n' + body + '\n```']) {
    const r = parseRoleOutput(text, 'qa');
    assert.equal(r.verdict, 'ok', text.slice(0, 20));
    assert.equal(r.summary, '정상 {중괄호} 포함');
  }
});

test('앞에 다른 중괄호가 있어도 올바른 JSON 객체를 찾는다', () => {
  const r = parseRoleOutput('예: {잘못된 것} 그리고 ' + json(ok), 'pm');
  assert.equal(r.verdict, 'ok');
});

test('알 수 없는 verdict는 concern, 알 수 없는 severity는 minor, findings가 배열이 아니면 빈 배열', () => {
  const r = parseRoleOutput(json({ verdict: '좋음', summary: 's', findings: [{ severity: 'huge', text: 't' }, { severity: 'info' }, 'str', null] }), 'x');
  assert.equal(r.verdict, 'concern');
  assert.deepEqual(r.findings, [{ severity: 'minor', text: 't' }]);
  assert.deepEqual(parseRoleOutput(json({ verdict: 'ok', summary: 's', findings: 'x' }), 'x').findings, []);
});

test('빈 출력, null, 숫자, JSON 아님, 깨진 JSON은 failed (예외 없음)', () => {
  for (const bad of ['', '   \n', null, undefined, 42, {}, '그냥 문장입니다. 좋아 보입니다.', '{"verdict": "ok", ']) {
    const r = parseRoleOutput(bad, 'x');
    assert.equal(r.verdict, 'failed', String(bad));
    assert.ok(r.error);
    assert.deepEqual(r.findings, []);
  }
  assert.equal(parseRoleOutput('', 'x').error, '빈 응답');
  assert.equal(parseRoleOutput('그냥 문장', 'x').error, '형식 오류');
  assert.ok(parseRoleOutput('그냥 문장입니다', 'x').summary.startsWith('그냥 문장'));
});

test('비밀값은 마스킹되고 긴 문자열은 잘린다', () => {
  const r = parseRoleOutput(json({ verdict: 'concern', summary: '키 노출 sk-abcdefghijklmnopqrstuvwx1234 ' + 'x'.repeat(200), findings: [{ severity: 'critical', text: 'token=abcd1234efgh ' + 'y'.repeat(500), file: '.env' }] }), 'sec');
  assert.ok(r.summary.length <= 80);
  assert.ok(!JSON.stringify(r).includes('sk-abcdefghijklmnopqrstuvwx1234'));
  assert.ok(!JSON.stringify(r).includes('abcd1234efgh'));
  assert.ok(r.findings[0].text.length <= 300);
  assert.equal(r.findings[0].file, '설정 파일');
  assert.equal(parseRoleOutput('실패 sk-abcdefghijklmnopqrstuvwx1234', 'x').summary.includes('sk-abcdef'), false);
});

test('ok인데 major/critical 지적이 있으면 concern으로 올린다', () => {
  assert.equal(parseRoleOutput(json({ verdict: 'ok', summary: 's', findings: [{ severity: 'major', text: 't' }] }), 'x').verdict, 'concern');
  assert.equal(parseRoleOutput(json({ verdict: 'ok', summary: 's', findings: [{ severity: 'minor', text: 't' }] }), 'x').verdict, 'ok');
});

const R = (verdict, findings = []) => ({ roleId: 'r', verdict, summary: '', findings });

test('aggregateVerdict: block > concern(failed 포함) > ok, 빈 목록은 ok', () => {
  assert.equal(aggregateVerdict([]), 'ok');
  assert.equal(aggregateVerdict([R('ok'), R('ok')]), 'ok');
  assert.equal(aggregateVerdict([R('ok'), R('concern')]), 'concern');
  assert.equal(aggregateVerdict([R('ok'), R('failed')]), 'concern');
  assert.equal(aggregateVerdict([R('concern'), R('block'), R('failed')]), 'block');
});

test('countConcerns: ok는 0, failed는 1, concern/block은 minor 이상 지적 수(최소 1)', () => {
  assert.equal(countConcerns([R('ok', [{ severity: 'minor', text: 'x' }])]), 0);
  assert.equal(countConcerns([R('failed')]), 1);
  assert.equal(countConcerns([R('concern', [{ severity: 'info', text: 'a' }, { severity: 'minor', text: 'b' }, { severity: 'major', text: 'c' }])]), 2);
  assert.equal(countConcerns([R('concern', [{ severity: 'info', text: 'a' }])]), 1);
  assert.equal(countConcerns([R('block', [{ severity: 'critical', text: 'a' }]), R('ok'), R('failed')]), 2);
});
