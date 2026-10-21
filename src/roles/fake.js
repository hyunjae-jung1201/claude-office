// 화면 확인용 가짜 역할자 실행기(CLAUDE_OFFICE_FAKE_ROLES=1): 1~3초 뒤 정해진 JSON을 돌려준다. 실제 claude 를 부르지 않는다.
const ANSWERS = [
  { verdict: 'ok', summary: '요구사항에 맞고 문제 없음', findings: [] },
  { verdict: 'concern', summary: '빈 입력 처리가 빠져 있음', findings: [{ severity: 'major', text: '빈 문자열이 들어오면 예외가 난다', file: 'src/app.js', line: 12 }, { severity: 'minor', text: '테스트가 없다' }] },
  { verdict: 'block', summary: '비밀값이 코드에 들어감', findings: [{ severity: 'critical', text: 'API 키가 하드코딩돼 있다 <script>alert(1)</script>', file: 'src/config.js', line: 3 }] },
];
let n = 0;

export async function fakeRun() {
  const answer = ANSWERS[n++ % ANSWERS.length];
  await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
  return JSON.stringify(answer);
}
