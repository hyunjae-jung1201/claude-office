// 요약기·말풍선·로그에 들어가기 전에 비밀값을 가린다.
const SENSITIVE_PATH =
  /(?:[^\s"']*\/)?(?:\.env(?:\.[\w-]+)?|[\w.-]*\.pem|[\w.-]*\.key|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?|[\w.-]*credentials[\w.-]*)(?=$|[\s"'])/g;

const RULES = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '***'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '***'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '***'],
  [/\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer ***'],
  [/\b(password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key)(\s*[=:]\s*)["']?[^\s"']+["']?/gi, '$1$2***'],
  [SENSITIVE_PATH, '설정 파일'],
  [/\b(?=[A-Za-z0-9+_-]*\d)[A-Za-z0-9+_-]{20,}\b/g, '***'],
];

export function maskSecrets(text) {
  let out = String(text);
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}
