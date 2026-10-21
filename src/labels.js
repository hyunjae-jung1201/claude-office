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
  if (!d) return DEFAULT_LABEL[cat];

  if (cat === 'run') return fit(`${d.split(/\s+/)[0]} 실행 중`);
  if (/^https?:\/\//.test(d)) return '웹 조회 중';
  if (looksLikePath(d)) {
    const name = d.split('/').filter(Boolean).pop();
    return fit(`${name} ${cat === 'read' ? '읽는 중' : '수정 중'}`);
  }
  return DEFAULT_LABEL[cat];
}
