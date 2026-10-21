#!/usr/bin/env node
// 화면 확인용 데모: 가짜 hook 이벤트를 서버로 보내 5개 팀의 모든 상태와 팀원 출퇴근을 재현한다.
// 사용: node scripts/demo.js [서버주소] [config경로]   예) node scripts/demo.js http://127.0.0.1:7410
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:7410';
const cfg = JSON.parse(readFileSync(process.argv[3] ?? new URL('../config.json', import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fast = process.env.DEMO_FAST === '1'; // 40초 대신 짧은 시간 사용(config.celebrateAfterSeconds를 낮춘 서버용)

async function send(team, name, extra = {}) {
  const res = await fetch(`${base}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: `demo-${team}`, cwd: cfg.projects[team].path, hook_event_name: name, ...extra }),
  });
  if (res.status !== 204) console.error(`${name} → ${res.status}`);
}
const tool = (team, tool_name, tool_input, extra = {}) => send(team, 'PreToolUse', { tool_name, tool_input, ...extra });

console.log('1) 세션 시작: 5팀 모두 휴게실 수면 → 깨어남');
for (let i = 0; i < 5; i++) await send(i, 'SessionStart');
await sleep(1500);

console.log('2) 팀별 서로 다른 작업');
await send(0, 'UserPromptSubmit', { prompt: '로그인 화면을 고쳐줘' });
await tool(0, 'Edit', { file_path: `${cfg.projects[0].path}/src/Login.kt` });
await send(1, 'UserPromptSubmit', { prompt: '데이터 받아줘' });
await tool(1, 'Bash', { command: 'wget https://example.com/train_images.zip -O data/train.zip' });
await tool(2, 'Read', { file_path: `${cfg.projects[2].path}/docs/spec.md` });
await tool(3, 'Bash', { command: 'npm run build' });
await send(3, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
await send(4, 'UserPromptSubmit', { prompt: '모델 학습해줘' });
await tool(4, 'Agent', { description: '모델·데이터 조사', prompt: '...' });
await sleep(3000);

console.log('3) 폐암 WSI 팀: 하위 에이전트 3명 투입 (모델 찾기/데이터 찾기/학습)');
const agents = [['a1', 'Explore', 'Read', { file_path: `${cfg.projects[4].path}/models/list.md` }], ['a2', 'general-purpose', 'Bash', { command: 'find data -name "*.svs"' }], ['a3', 'general-purpose', 'Bash', { command: 'python train.py --epochs 3' }]];
for (const [id, type] of agents) await send(4, 'SubagentStart', { agent_id: id, agent_type: type });
for (const [id, type, name, input] of agents) await tool(4, name, input, { agent_id: id, agent_type: type });
await sleep(5000);

console.log('4) 팀원 퇴근 + 완료 연출(오래 일한 팀)');
for (const [id, type] of agents) { await send(4, 'SubagentStop', { agent_id: id, agent_type: type }); await sleep(800); }
await send(4, 'Stop');
if (!fast) { /* prompt 이후 30초 이상이 지나야 완료 연출. 서버 설정의 celebrateAfterSeconds를 낮춰 두면 즉시 확인 가능 */ }
await sleep(1500);
await send(0, 'Stop');
await send(1, 'Stop');
console.log('끝. 서버를 celebrateAfterSeconds=1 로 띄우면 완료 연출이 바로 보입니다.');
