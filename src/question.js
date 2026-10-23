// 마지막 응답이 사용자에게 답을 요구하는지: 끝부분(마지막 세 줄)에 물음표로 끝나는 문장이 있으면 질문으로 본다.
// "필요하면 말씀해 주세요" 같은 선택 안내는 답이 꼭 필요한 것이 아니므로 질문으로 치지 않는다.
// (src/remote-tail.cjs 에 같은 규칙의 복사본이 있다 — 다른 PC 에서 단독으로 실행되는 파일이라 모듈을 가져올 수 없다. 둘을 함께 고칠 것.)
export function asksQuestion(text) {
  if (typeof text !== 'string') return false;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3);
  return lines.some((l) => /[?？][\s)\]}>"'”’』」*_`]*$/.test(l));
}
