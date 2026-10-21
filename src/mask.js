// 요약기·말풍선·로그에 들어가기 전에 비밀값을 가린다.
const KEY_WORDS = '(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key)';

const RULES = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '***'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '***'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '***'],
  [/\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer ***'],
  // URL에 박힌 user:password@host(비밀번호에 / 포함 가능), :password@host, token@host
  [/(\b[A-Za-z][A-Za-z0-9+.-]*:\/\/)(?:[^:\/\s@]*:[^@\s]+|[^\/\s@:]+)@/g, '$1***@'],
  // KEY=값, KEY: 값, "key": "값" (GITHUB_TOKEN, my_password 같은 접두사 포함)
  [new RegExp(`([A-Za-z0-9_-]*${KEY_WORDS}[A-Za-z0-9_-]*["']?\\s*[=:]\\s*)(?:"[^"\\n]*"?|'[^'\\n]*'?|[^\\s"']+)`, 'gi'), '$1***'],
  // --password 값, --token 값 (공백 구분 플래그)
  [new RegExp(`(--?${KEY_WORDS}\\s+)["']?[^\\s"']+["']?`, 'gi'), '$1***'],
  // mysql -pVALUE (값이 붙은 형태만, `mkdir -p dir` 은 그대로)
  [/(\s-p)(?!\s)[^\s-]\S*/g, '$1***'],
  // 20자 이상이면서 숫자를 포함하는 긴 덩어리(해시, base64 키)
  [/\b(?=[A-Za-z0-9+_-]*\d)[A-Za-z0-9+_-]{20,}\b/g, '***'],
];

const SENSITIVE_NAME =
  /^(?:\.env(?:\.[\w-]+)?|[\w.-]*\.pem|[\w.-]*\.key|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?|[\w.-]*credentials[\w.-]*)$/;

// 공백 단위 토큰마다 마지막 경로 조각(/ 또는 = 뒤)이 민감한 파일 이름인지 본다. 선형 시간.
function maskPaths(text) {
  return text.replace(/[^\s"']+/g, (tok) => {
    const name = tok.split(/[\/=]/).pop();
    return SENSITIVE_NAME.test(name) ? '설정 파일' : tok;
  });
}

export function maskSecrets(text) {
  let out = String(text);
  for (const [re, to] of RULES) out = out.replace(re, to);
  return maskPaths(out);
}
