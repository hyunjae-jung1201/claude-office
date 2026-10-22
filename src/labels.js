import { DEFAULT_LABEL } from './state.js';

const LIMIT = 20;
const WAIT_LABEL = { approval: '승인 기다리는 중', answer: '답변 기다리는 중', plan: '계획 승인 기다리는 중' };
const fit = (s) => (s.length > LIMIT ? s.slice(0, LIMIT - 1) + '…' : s);
const looksLikePath = (d) => /^[~.]?\//.test(d) || /^[\w.-]+\.\w+$/.test(d);

export function ruleLabel(ev) {
  if (ev.type === 'wait') return WAIT_LABEL[ev.waitKind] ?? DEFAULT_LABEL.wait;
  const cat = ev.category;
  if (!cat) return DEFAULT_LABEL.idle;
  const d = ev.detail?.trim();
  if (ev.activity === 'planning') return '할 일·계획 정리 중';
  if (ev.activity === 'briefing') return '하위 에이전트에게 일 맡기는 중';
  if (ev.activity === 'research') return '웹에서 자료 조사 중';
  if (!d) return DEFAULT_LABEL[cat];

  if (cat === 'run') return fit(`${d.split(/\s+/)[0]} 실행 중`);
  if (/^https?:\/\//.test(d)) return '웹 조회 중';
  if (looksLikePath(d)) {
    const name = d.split('/').filter(Boolean).pop();
    return fit(`${name} ${cat === 'read' ? '읽는 중' : ev.activity === 'docs' ? '문서 수정 중' : '수정 중'}`);
  }
  return DEFAULT_LABEL[cat];
}
